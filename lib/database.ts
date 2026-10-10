import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let connection: Database.Database | undefined;
export function db() {
  if (!connection) {
    const path = process.env.DATABASE_PATH || "data/nachklang.sqlite";
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    connection = new Database(path);
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    connection.pragma("busy_timeout = 5000");
  }
  return connection;
}

export function migrateApp() {
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
  `);
}
