import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../lib/auth";
import { db, migrateApp } from "../lib/database";
import { encrypt } from "../lib/crypto";
import { life, disable, confirm, tick } from "../lib/life";
import { reviewRelease, releaseMessage, revokeMessage } from "../lib/message-release";
import { activate, reviewActivation } from "../lib/activation";
const dir = mkdtempSync(join(tmpdir(), "nk-safety-"));
process.env.DATABASE_PATH = join(dir, "synthetic.sqlite");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
process.env.MESSAGE_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const now = Date.now();
const payload = {recipientName: "Synthetic", recipientEmail: "person@example.test", body: "Synthetic prose only"};
before(async () => {await (await getMigrations(authOptions())).runMigrations(); migrateApp();});
beforeEach(() => {
 db().exec("DELETE FROM event; DELETE FROM message; DELETE FROM life; DELETE FROM user;");
 for (const id of ["one", "two"]) {db().prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run(id,id,`${id}@example.test`,1,now,now); life(id);}
 db().prepare("UPDATE worker SET last_tick = ?").run(now);
 db().prepare("INSERT INTO message(id,user_id,payload,created_at,updated_at) VALUES('message','one',?,?,?)").run(encrypt(payload),now,now);
});
after(() => {db().close(); rmSync(dir,{recursive:true,force:true});});
test("revocation while first send awaits prevents unclaimed second dispatch", async () => {
 db().prepare("UPDATE life SET state='released' WHERE user_id='one'").run();
 db().prepare("UPDATE message SET ready=1").run();
 db().prepare("INSERT INTO message(id,user_id,payload,ready,created_at,updated_at) VALUES('second','one',?,1,?,?)").run(encrypt(payload),now,now);
 const sent: string[]=[];
 await tick(now, async mail => { sent.push(mail.messageId!); if(sent.length===1) {revokeMessage('one','second'); assert.throws(()=>revokeMessage('one','message'));} });
 assert.equal(sent.length,1);
 assert.equal((db().prepare("SELECT status FROM message WHERE id='second'").get() as {status:string}).status,'pending');
});
test("release tokens are owned, explicit, expiring, and invalidated by edits or lifecycle changes", () => {
 const r = reviewRelease("one", "message", now);
 assert.throws(() => releaseMessage("two", {...r,confirmed:true}, now));
 assert.throws(() => releaseMessage("one", r, now));
 assert.throws(() => releaseMessage("one", {...r,confirmed:true}, now+300001));
 db().prepare("UPDATE message SET revision=revision+1, release_token=NULL WHERE id='message'").run();
 assert.throws(() => releaseMessage("one", {...r,confirmed:true}, now));
 const fresh = reviewRelease("one", "message", now);
 db().prepare("UPDATE life SET state='released' WHERE user_id='one'").run();
 assert.throws(() => releaseMessage("one", {...fresh,confirmed:true}, now));
 assert.throws(() => reviewRelease("one", "message", now));
});
test("revoke is easy for unclaimed mail but never pretends to retract started sends", () => {
 const r=reviewRelease("one", "message", now); releaseMessage("one", {...r,confirmed:true}, now);
 revokeMessage("one", "message");
 assert.equal((db().prepare("SELECT ready FROM message").get() as {ready:number}).ready,0);
 assert.throws(() => releaseMessage("one", {...r,confirmed:true}, now));
 db().prepare("UPDATE message SET status='sending'").run(); assert.throws(() => revokeMessage("one","message"));
});
test("readiness rechecks stale workers, owner verification, expiry and message changes", () => {
 const r=reviewActivation("one",now); assert.equal(r.releasedCount,0); assert.equal(r.draftCount,1);
 assert.throws(() => activate("one",{...r,confirmed:true},now));
 db().prepare("UPDATE worker SET last_tick=?").run(now-3600001); assert.throws(() => activate("one",{...r,confirmed:true,bypassReceipt:true},now));
 db().prepare("UPDATE worker SET last_tick=?").run(now); db().prepare("UPDATE message SET revision=revision+1").run();
 assert.throws(() => activate("one",{...r,confirmed:true,bypassReceipt:true},now));
 const fresh=reviewActivation("one",now); assert.throws(() => activate("one",{...fresh,confirmed:true,bypassReceipt:true},now+300001));
 db().prepare("UPDATE user SET emailVerified=0 WHERE id='one'").run(); assert.throws(() => reviewActivation("one",now));
});
test("pause and confirmation retain unresolved mail failures and block receipt bypass", () => {
 for (const action of [disable, confirm]) {
  db().prepare("UPDATE life SET state='awaiting', check_failed_at=? WHERE user_id='one'").run(now-1000);
  action('one');
  assert.equal(life('one').check_failed_at,now-1000);
  disable('one');
  assert.throws(()=>reviewActivation('one',now),/Mailproblem/);
 }
});
test("unresolved mail failure never restarts a countdown after confirmation", async () => {
 db().prepare("UPDATE life SET state='active', next_check=?, check_failed_at=? WHERE user_id='one'").run(now,now-1000);
 await tick(now,async()=>{});
 assert.equal(life('one').deadline,null);
 assert.equal(life('one').check_failed_at,now-1000);
});
test("transport rejection and ambiguous timeout persist distinct secret-free outcomes without retry", async () => {
 for (const [error,kind] of [[Object.assign(new Error('secret SMTP password'),{responseCode:550,command:'RCPT TO'}),'rejected'],[Object.assign(new Error('secret SMTP password'),{code:'ETIMEDOUT',command:'DATA'}),'unknown']] as const) {
  db().prepare("UPDATE life SET state='released' WHERE user_id='one'").run();
  db().prepare("UPDATE message SET ready=1,status='pending'").run();
  let attempts=0;
  await tick(now,async()=>{attempts++;throw error;});
  const row=db().prepare("SELECT * FROM message").get() as Record<string,unknown>;
  assert.equal(row.failure_kind,kind);
  assert.doesNotMatch(String(row.failure_reason),/secret|password/);
  await tick(now+1000,async()=>{attempts++;});
  assert.equal(attempts,1);
 }
});
test("expired worker cannot overwrite successor outcome or lease", async () => {
 db().prepare("UPDATE life SET state='released' WHERE user_id='one'").run();
 db().prepare("UPDATE message SET ready=1").run();
 let successor=0;
 await tick(now,async()=>{ successor=(db().prepare("SELECT lease_until FROM worker").get() as {lease_until:number}).lease_until+1; await tick(successor,async()=>{}); });
 const row=db().prepare("SELECT status FROM message").get() as {status:string};
 assert.equal(row.status,'failed');
 assert.equal((db().prepare("SELECT last_tick FROM worker").get() as {last_tick:number}).last_tick,successor);
});
test("fresh activation review cannot bypass failure hidden by pause or confirmation", () => {
 for (const action of [disable, confirm]) {
  db().prepare("UPDATE life SET state='disabled',check_failed_at=NULL WHERE user_id='one'").run();
  const r=reviewActivation('one',now);
  db().prepare("UPDATE life SET check_failed_at=? WHERE user_id='one'").run(now-1000);
  action('one'); disable('one');
  assert.throws(()=>activate('one',{...r,confirmed:true,bypassReceipt:true},now),/Mailproblem/);
 }
});
test("changed queued payload is never dispatched from a stale snapshot", async () => {
 db().prepare("UPDATE life SET state='released' WHERE user_id='one'").run();
 db().prepare("UPDATE message SET ready=1").run();
 db().prepare("INSERT INTO message(id,user_id,payload,ready,created_at,updated_at) VALUES('second','one',?,1,?,?)").run(encrypt(payload),now,now);
 let count=0;
 await tick(now,async()=>{count++;db().prepare("UPDATE message SET payload=?,revision=revision+1 WHERE id='second'").run(encrypt({...payload,body:'changed'}));});
 assert.equal(count,1);
});
test("mail failure observed after a concurrent pause is retained", async () => {
 db().prepare("UPDATE life SET state='active',next_check=? WHERE user_id='one'").run(now);
 await tick(now,async()=>{disable('one');throw new Error('ambiguous');});
 assert.equal(life('one').state,'disabled');
 assert.equal(life('one').check_failed_at,now);
 assert.throws(()=>reviewActivation('one',now),/Mailproblem/);
});
for (const [label, action, expectedState] of [["pause", disable, "disabled"], ["confirmation", confirm, "active"]] as const) {
 test(`reminder failure after concurrent ${label} retains failure and blocks subsequent workers`, async () => {
  db().prepare("UPDATE life SET state='awaiting', deadline=?, token_hash=?, reminder_stage=0 WHERE user_id='one'").run(now+86_400_000,randomBytes(32).toString('hex'));
  db().prepare("UPDATE message SET ready=1").run();
  const staleReview = (() => { disable('one'); const review=reviewActivation('one',now); db().prepare("UPDATE life SET state='awaiting', deadline=?, token_hash=?, reminder_stage=0 WHERE user_id='one'").run(now+86_400_000,randomBytes(32).toString('hex')); return review; })();
  let calls=0;
  await tick(now,async()=>{calls++; action('one',now); throw new Error('synthetic reminder failure');});
  assert.equal(calls,1);
  assert.equal(life('one').state,expectedState,'preserve the concurrent user transition');
  assert.equal(life('one').check_failed_at,now);
  assert.equal(life('one').deadline,null);
  if (expectedState === 'disabled') assert.throws(()=>reviewActivation('one',now),/Mailproblem/);
  assert.throws(()=>activate('one',{...staleReview,confirmed:true,bypassReceipt:true},now),/Mailproblem/);
  for (const later of [now+1000,now+86_400_001]) await tick(later,async()=>{calls++;});
  assert.equal(calls,1,'no reminder, new countdown or message dispatch after the failed reminder');
  assert.equal(life('one').state,'disabled');
  assert.equal(life('one').deadline,null);
  assert.equal(life('one').check_failed_at,now);
  assert.equal((db().prepare("SELECT status FROM message WHERE id='message'").get() as {status:string}).status,'pending');
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM event WHERE kind='reminder_failed' AND user_id='one'").get() as {n:number}).n,1);
  db().prepare("INSERT INTO mail_probe(user_id,requested_at,accepted_at,received_at) VALUES('one',?,?,?)").run(now+1,now+2,now+3);
  db().prepare("UPDATE worker SET last_tick=?").run(now+86_400_001);
  await tick(now+86_400_001,async()=>{calls++;});
  assert.equal(calls,1);
  const recovered=reviewActivation('one',now+86_400_001);
  activate('one',{...recovered,confirmed:true},now+86_400_001);
  assert.equal(life('one').state,'active');
  assert.equal(life('one').check_failed_at,null);
 });
}
test("known mail failure blocks activation until a newer own-inbox receipt", () => {
 db().prepare("UPDATE life SET check_failed_at=? WHERE user_id='one'").run(now-1000);
 assert.throws(() => reviewActivation("one",now), /Mailproblem/);
 db().prepare("INSERT INTO mail_probe(user_id,requested_at,accepted_at,received_at) VALUES('one',?,?,?)").run(now-500,now-400,now-200);
 const r=reviewActivation("one",now); assert.equal(r.received,true);
 activate("one",{...r,confirmed:true},now); assert.equal(life("one").state,"active");
 disable("one"); assert.equal(life("one").state,"disabled");
});
