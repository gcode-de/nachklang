import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { secret } from "./config";

export function encryptionKey() {
  const key = Buffer.from(secret("MESSAGE_ENCRYPTION_KEY"), "hex");
  if (
    key.length !== 32 ||
    !/^[a-f0-9]{64}$/i.test(process.env.MESSAGE_ENCRYPTION_KEY!)
  ) {
    throw new Error("MESSAGE_ENCRYPTION_KEY muss aus 64 Hex-Zeichen bestehen.");
  }
  return key;
}

export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decrypt<T>(value: string): T {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(data.subarray(28)),
      cipher.final(),
    ]).toString(),
  );
}

export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
