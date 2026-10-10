"use client";
import { useState, type FormEvent } from "react";
import { authClient } from "../../lib/auth-client";
export default function ResetPassword() {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const password = String(new FormData(e.currentTarget).get("password"));
    const token =
      new URLSearchParams(window.location.search).get("token") || "";
    try {
      const result = await authClient.resetPassword({
        token,
        newPassword: password,
      });
      setNotice(
        result.error
          ? "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an."
          : "Passwort geändert. Du kannst dich jetzt anmelden.",
      );
    } catch {
      setNotice("Passwort konnte nicht geändert werden.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="narrow">
      <h1>Ein neues Passwort.</h1>
      <form className="panel stack" onSubmit={submit}>
        <label>
          Neues Passwort
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <button disabled={busy}>Passwort ändern</button>
        <p role="status">{notice}</p>
        <a href="/login">Zur Anmeldung</a>
      </form>
    </section>
  );
}
