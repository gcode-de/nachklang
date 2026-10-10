"use client";
import { useState, type FormEvent } from "react";
import { authClient } from "../../lib/auth-client";
export default function Login() {
  const [mode, setMode] = useState<"login" | "signup" | "reset" | "verify">(
    "login",
  );
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password") || "");
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              email,
              password,
              name: String(form.get("name")),
              callbackURL: "/dashboard",
            })
          : mode === "reset"
            ? await authClient.requestPasswordReset({
                email,
                redirectTo: "/reset-password",
              })
            : mode === "verify"
              ? await authClient.sendVerificationEmail({
                  email,
                  callbackURL: "/dashboard",
                })
              : await authClient.signIn.email({ email, password });
      if (result.error)
        setNotice(
          mode === "login"
            ? "Anmeldung fehlgeschlagen. Prüfe deine Zugangsdaten und bestätige deine E-Mail-Adresse."
            : "Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.",
        );
      else if (mode === "login") window.location.assign("/dashboard");
      else
        setNotice(
          mode === "signup"
            ? "Bitte bestätige deine E-Mail-Adresse über die Nachricht in deinem Postfach."
            : "Wenn die Adresse zu einem passenden Konto gehört, erhältst du eine E-Mail.",
        );
    } catch {
      setNotice(
        "Der Dienst ist gerade nicht erreichbar. Bitte versuche es erneut.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="narrow">
      <p className="eyebrow">DEIN PERSÖNLICHER ORT</p>
      <h1>
        {mode === "signup"
          ? "Worte bewahren."
          : mode === "reset"
            ? "Neu beginnen."
            : mode === "verify"
              ? "E-Mail bestätigen."
              : "Willkommen zurück."}
      </h1>
      <form className="panel stack" onSubmit={submit}>
        {mode === "signup" && (
          <label>
            Dein Name
            <input name="name" required maxLength={200} autoComplete="name" />
          </label>
        )}
        <label>
          E-Mail-Adresse
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            maxLength={254}
          />
        </label>
        {(mode === "login" || mode === "signup") && (
          <label>
            Passwort
            <input
              name="password"
              type="password"
              required
              minLength={mode === "signup" ? 12 : 1}
              maxLength={128}
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
            />
            {mode === "signup" && <small>Mindestens 12 Zeichen.</small>}
          </label>
        )}
        {mode === "signup" && (
          <p className="muted">
            Nachklang versendet nach einer ausgebliebenen Lebensbestätigung. Das
            Konto startet mit deaktivierter Prüfung.
          </p>
        )}
        <button disabled={busy}>
          {busy
            ? "Einen Moment …"
            : mode === "signup"
              ? "Konto erstellen"
              : mode === "reset"
                ? "Link anfordern"
                : mode === "verify"
                  ? "Bestätigungslink anfordern"
                  : "Anmelden"}
        </button>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
      </form>
      <div className="auth-links">
        {(
          [
            ["login", "Anmelden"],
            ["signup", "Konto erstellen"],
            ["reset", "Passwort vergessen?"],
            ["verify", "E-Mail erneut bestätigen"],
          ] as const
        )
          .filter(([key]) => key !== mode)
          .map(([key, label]) => (
            <button
              className="text-button"
              key={key}
              onClick={() => {
                setMode(key);
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
      </div>
    </section>
  );
}
