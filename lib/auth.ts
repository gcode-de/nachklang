import { betterAuth, type BetterAuthOptions } from "better-auth";
import { db } from "./database";
import { appUrl, secret } from "./config";
import { sendMail } from "./mail";

let instance: ReturnType<typeof createAuth> | undefined;
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
    database: db(),
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
        await sendMail({
          to: user.email,
          subject: "Nachklang: E-Mail bestätigen",
          text: `Willkommen bei Nachklang. Bestätige bitte deine E-Mail-Adresse:\n\n${url}`,
        });
      },
    },
    user: { deleteUser: { enabled: true } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    },
  } satisfies BetterAuthOptions;
}
