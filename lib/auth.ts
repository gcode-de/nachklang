import { betterAuth, type BetterAuthOptions } from "better-auth";
import { CompiledQuery, SqliteDialect } from "kysely";
import { queueAfterTransactionHook } from "@better-auth/core/context";
import { openDatabase } from "./database";
import { appUrl, secret } from "./config";
import { sendMail } from "./mail";

let instance: ReturnType<typeof createAuth> | undefined;

class AuthSqliteDialect extends SqliteDialect {
  override createDriver() {
    const driver = super.createDriver();
    // Reserve the writer before async password hashing can leave a stale WAL snapshot.
    driver.beginTransaction = async (connection) => {
      await connection.executeQuery(CompiledQuery.raw("BEGIN IMMEDIATE"));
    };
    return driver;
  }
}
export function auth() {
  return (instance ??= createAuth());
}
function createAuth() {
  return betterAuth(authOptions());
}
export function authOptions() {
  return {
    appName: "Nachklang",
    baseURL: appUrl(),
    secret: secret("BETTER_AUTH_SECRET"),
    database: {
      dialect: new AuthSqliteDialect({ database: async () => openDatabase() }),
      type: "sqlite",
      transaction: true,
    },
    trustedOrigins: [appUrl()],
    emailAndPassword: {
      enabled: true,
      disableSignUp: process.env.ALLOW_REGISTRATION === "false",
      requireEmailVerification: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "Nachklang: Passwort zurücksetzen",
          text: `Hier kannst du dein Passwort zurücksetzen:\n\n${url}\n\nFalls du das nicht angefordert hast, ignoriere diese E-Mail.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        // SMTP must not hold SQLite's writer lock or send for a rolled-back account.
        await queueAfterTransactionHook(() =>
          sendMail({
            to: user.email,
            subject: "Nachklang: E-Mail bestätigen",
            text: `Willkommen bei Nachklang. Bestätige bitte deine E-Mail-Adresse:\n\n${url}`,
          }),
        );
      },
    },
    user: { deleteUser: { enabled: true } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    },
  } satisfies BetterAuthOptions;
}
