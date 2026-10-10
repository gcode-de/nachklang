import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../lib/auth";
import { db, migrateApp } from "../lib/database";
import { decrypt, encryptionKey } from "../lib/crypto";
encryptionKey();
const { runMigrations } = await getMigrations(authOptions());
await runMigrations();
migrateApp();
const sample = db().prepare("SELECT payload FROM message LIMIT 1").get() as
  | { payload: string }
  | undefined;
if (sample) decrypt(sample.payload);
console.log("Datenbank bereit.");
