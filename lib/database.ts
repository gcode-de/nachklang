import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let connection: Database.Database | undefined;
export function db() {
  if (!connection) {
    connection = openDatabase();
  }
  return connection;
}

export function openDatabase() {
  const path = process.env.DATABASE_PATH || "data/nachklang.sqlite";
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  return database;
}

export function migrateApp() {
  db().transaction(() => {
    db().exec(`
    CREATE TABLE IF NOT EXISTS life (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'disabled' CHECK(state IN ('disabled','active','awaiting','released')),
      next_check INTEGER, deadline INTEGER, token_hash TEXT UNIQUE,
      confirmed_at INTEGER, released_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, delivery_date TEXT,
      ready INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sent_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS message_owner ON message(user_id);
    CREATE TABLE IF NOT EXISTS event (
      id INTEGER PRIMARY KEY, user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worker (
      id INTEGER PRIMARY KEY CHECK(id = 1), last_tick INTEGER, lease_until INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO worker(id) VALUES (1);
    CREATE TABLE IF NOT EXISTS admin_alert (
      id INTEGER PRIMARY KEY CHECK(id = 1), pending_count INTEGER NOT NULL DEFAULT 0,
      first_failure INTEGER, last_failure INTEGER, last_attempt INTEGER, last_sent INTEGER
    );
    CREATE TABLE IF NOT EXISTS mail_probe (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE, requested_at INTEGER NOT NULL,
      accepted_at INTEGER, received_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS activation_review (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL, context TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
    const messageColumns = new Set((db().prepare("PRAGMA table_info(message)").all() as { name: string }[]).map(row => row.name));
    for (const [name, type] of [["revision", "INTEGER NOT NULL DEFAULT 0"], ["release_token", "TEXT"], ["release_context", "TEXT"], ["release_expires", "INTEGER"], ["failure_kind", "TEXT"], ["failure_reason", "TEXT"], ["dispatch_owner", "TEXT"]]) {
      if (!messageColumns.has(name)) db().exec(`ALTER TABLE message ADD COLUMN ${name} ${type}`);
    }
    if (!(db().prepare("PRAGMA table_info(worker)").all() as {name:string}[]).some(c => c.name === "lease_owner")) db().exec("ALTER TABLE worker ADD COLUMN lease_owner TEXT");
    db().prepare("UPDATE message SET failure_kind='unknown' WHERE status='failed' AND failure_kind IS NULL").run();
    const columns = new Set(
      (db().prepare("PRAGMA table_info(life)").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    );
    if (!columns.has("check_sent_at")) {
      db().exec(
        "INSERT INTO event(user_id, kind, created_at) SELECT user_id, 'upgrade_paused', CAST(strftime('%s','now') AS INTEGER) * 1000 FROM life WHERE state IN ('awaiting','released'); UPDATE life SET state = 'disabled', next_check = NULL, deadline = NULL, token_hash = NULL, released_at = NULL WHERE state IN ('awaiting','released')",
      );
    }
    for (const column of [
      "check_sent_at",
      "check_inflight",
      "check_failed_at",
      "reminder_stage",
    ]) {
      if (!columns.has(column))
        db().exec(`ALTER TABLE life ADD COLUMN ${column} INTEGER`);
    }
  })();
}
