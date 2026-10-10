import { db } from "../lib/database";
import { dirname, join } from "node:path";
const target = join(
  dirname(process.env.DATABASE_PATH || "data/nachklang.sqlite"),
  "backup.sqlite",
);
await db().backup(target);
console.log("Konsistente SQLite-Sicherung erstellt.");
