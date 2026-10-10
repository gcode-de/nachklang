import { flushAdminAlerts } from "../lib/admin-alerts";
import { appUrl } from "../lib/config";
import { encryptionKey, decrypt } from "../lib/crypto";
import { db } from "../lib/database";
import { tick } from "../lib/life";
encryptionKey();
appUrl();
const sample = db().prepare("SELECT payload FROM message LIMIT 1").get() as
  { payload: string } | undefined;
if (sample) decrypt(sample.payload);
try {
  await tick();
} finally {
  await flushAdminAlerts();
}
console.log("Prüf- und Versandlauf abgeschlossen.");
