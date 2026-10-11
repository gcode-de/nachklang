"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { authClient } from "../../lib/auth-client";
import Editor from "./editor";
import { action } from "../../lib/browser-action";
import { executionStatus, deliverySummary } from "../../lib/message-status";

type Message = {
  id: string;
  revision: number;
  recipientName: string;
  recipientEmail: string;
  body: string;
  delivery_date: string | null;
  ready: number;
  status: string;
  sent_at: number | null;
};
type Data = {
  user: { name: string; email: string };
  life: {
    state: string;
    next_check: number | null;
    deadline: number | null;
    confirmed_at: number | null;
    check_sent_at: number | null;
    check_failed_at: number | null;
    check_inflight: number | null;
  };
  mailTest: {
    requested_at: number;
    accepted_at: number | null;
    received_at: number | null;
  } | null;
  worker: { last_tick: number | null };
  messages: Message[];
  events: { kind: string; created_at: number }[];
};
const date = (time: number | null) =>
  time
    ? new Date(time).toLocaleString("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    : "—";
const labels: Record<string, string> = {
  message_armed: "Nachrichtenfreigabe ausdrücklich bestätigt",
  message_revoked: "Nachrichtenfreigabe widerrufen",
  receipt_warning_accepted: "Aktiviert trotz unbestätigtem Postfachempfang",
  upgrade_paused: "Prüfung beim Update zur Sicherheit pausiert",
  reminder_sent: "Countdown-Erinnerung vom Mailserver angenommen",
  reminder_failed: "Erinnerung fehlgeschlagen – Prüfung automatisch pausiert",
  mail_test_sent: "Testmail vom Mailserver angenommen",
  mail_test_failed: "Testmail fehlgeschlagen",
  mail_test_received: "Empfang der Testmail bestätigt",
  confirmed: "Lebenszeichen bestätigt",
  disabled: "Prüfung deaktiviert",
  check_sent: "Prüf-E-Mail vom Mailserver angenommen",
  check_failed: "Prüf-E-Mail fehlgeschlagen; keine Versandfreigabe",
  released: "Antwortfrist abgelaufen, Versand freigegeben",
  message_sent: "Nachricht vom Mailserver angenommen",
  message_failed: "Versand fehlgeschlagen oder unklar",
  outage_reset: "Nach Ausfall: neue Prüfung erforderlich",
  retry_armed: "Erneuter Versand vorgemerkt",
  message_deleted: "Nachricht gelöscht",
};

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [notice, setNotice] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Message | "new" | null>(null);
  const [account, setAccount] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [activation, setActivation] = useState<{token: string; email: string; received: boolean; releasedCount: number; draftCount: number; nextCheck: number} | null>(null);
  const [bypassReceipt, setBypassReceipt] = useState(false);
  const editorOrigin = useRef<string>("new-message");
  const fetchSequence = useRef(0);
  const [clock, setClock] = useState(Date.now());
  const [refreshed, setRefreshed] = useState<number | null>(null);
  const reload = useCallback(async () => {
    const sequence = ++fetchSequence.current;
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok)
        throw new Error("Dashboard konnte nicht geladen werden.");
      const snapshot = await response.json();
      if (sequence !== fetchSequence.current) return;
      setData(snapshot);
      setRefreshed(Date.now());
      setFetchError("");
    } catch (error) {
      setFetchError(
        error instanceof Error ? error.message : "Dienst nicht erreichbar.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const poll = window.setInterval(() => {
      void reload();
    }, 15_000);
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    const focus = () => {
      void reload();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(poll);
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [reload]);
  async function run(input: Record<string, unknown>) {
    setBusy(true);
    setNotice("");
    setUrgent(false);
    try {
      await action(input);
      if (input.action === "activate") {setActivation(null); setNotice("Monatliche Prüfung ausdrücklich aktiviert.");}
      await reload();
      if (input.action === "disable")
        setNotice(
          "Gestoppt: Die Prüfung ist pausiert. Noch nicht begonnene Sendungen werden nicht versendet.",
        );
      if (input.action === "confirm")
        setNotice(
          "Lebenszeichen gespeichert. Der ausstehende Versand ist gestoppt; die nächste Prüfung folgt in einem Monat.",
        );
      if (input.action === "test_mail")
        setNotice(
          "Testmail vom Mailserver angenommen. Bitte bestätige den Empfang über den Link in der E-Mail.",
        );
    } catch (error) {
      setUrgent(true);
      setNotice(
        error instanceof Error ? error.message : "Aktion fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <section className="narrow">
        <p>Deine Nachrichten werden geladen …</p>
      </section>
    );
  if (!data)
    return (
      <section className="narrow">
        <p role="alert">{fetchError || notice}</p>
        <button onClick={reload}>Erneut laden</button>
      </section>
    );
  const state = data.life.state;
  const stale =
    !data.worker.last_tick || Date.now() - data.worker.last_tick > 60 * 60_000;
  return (
    <section className="dashboard">
      <div className="section-heading">
        <div>
          <p className="eyebrow">DEIN PERSÖNLICHER ORT</p>
          <h1>Hallo, {data.user.name.split(" ")[0]}.</h1>
          <p className="muted">
            Hier bewahrst du auf, was dir am Herzen liegt.
          </p>
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => setAccount(!account)}>
            Dein Konto
          </button>
          <button
            className="text-button"
            onClick={async () => {
              try {
                const result = await authClient.signOut();
                if (result.error) throw new Error();
                window.location.assign("/");
              } catch {
                setNotice("Abmelden fehlgeschlagen.");
              }
            }}
          >
            Abmelden
          </button>
        </div>
      </div>
      {notice && (
        <p role={urgent ? "alert" : "status"} className="notice">
          {notice}
        </p>
      )}
      {fetchError && (
        <p className="notice" role="alert">
          {fetchError} Der angezeigte Timerstatus kann veraltet sein. Eine
          Stop-Aktion ist erst nach erfolgreicher Serverbestätigung wirksam.
        </p>
      )}
      {stale && (
        <p className="notice">
          Der Prüfjob ist noch nicht gestartet oder seit über einer Stunde nicht
          gelaufen. Bitte prüfe den Timer im Homelab. Letzter Lauf:{" "}
          {date(data.worker.last_tick)}.
        </p>
      )}
      {account && <Account data={data} onSave={reload} onNotice={setNotice} />}
      <section
        className={`life-panel timer-panel ${state === "awaiting" || state === "released" ? "timer-alert" : ""}`}
        aria-label="Lebenstimer"
      >
        <div>
          <p className="eyebrow">MONATLICHE LEBENSBESTÄTIGUNG</p>
          <h2>
            {state === "awaiting"
              ? "Dein Countdown läuft."
              : state === "released"
                ? "Versand ist freigegeben."
                : state === "disabled"
                  ? "Dein Timer ist pausiert."
                  : "Die monatliche Prüfung ist aktiv."}
          </h2>
          {state === "awaiting" && (
            <>
              <p className="countdown">
                {(() => {
                  const seconds = Math.max(
                    0,
                    Math.ceil(((data.life.deadline || clock) - clock) / 1000),
                  );
                  return `${Math.floor(seconds / 86400)} Tage · ${String(Math.floor(seconds / 3600) % 24).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
                })()}
              </p>
              <p>
                Gestartet: {date(data.life.check_sent_at)}
                <br />
                Antwortfrist: {date(data.life.deadline)}
              </p>
              <p>
                Ohne Lebenszeichen werden danach deine freigegebenen Nachrichten
                versendet. Du kannst hier direkt stoppen – auch ohne die E-Mail.
              </p>
            </>
          )}
          {state === "released" && (
            <p>
              Stoppe jetzt die noch nicht begonnenen Sendungen. Bereits
              begonnene oder versendete E-Mails können nicht zurückgerufen
              werden.
            </p>
          )}
          {state === "active" && (
            <p>
              {data.life.check_inflight
                ? "Prüfmail wird gesendet. Der Countdown hat noch nicht begonnen."
                : `Nächste Prüfmail: ${date(data.life.next_check)}`}
              <br />
              Sieben Tage Antwortzeit ab Annahme der Prüfmail durch den
              Mailserver.
            </p>
          )}
          {state === "disabled" && (
            <p>
              Kein Countdown. Keine neue automatische Versandfreigabe. Bereits
              begonnene Sendungen können nicht zurückgerufen werden.
            </p>
          )}
          {data.life.check_failed_at && (
            <p className="notice" role="alert">
              Mailproblem am {date(data.life.check_failed_at)}. Kein laufender
              Countdown. Bitte prüfe den Mailversand mit einer Testmail.
            </p>
          )}
          <small>
            Zuletzt bestätigt: {date(data.life.confirmed_at)} · Status
            aktualisiert: {date(refreshed)}
          </small>
        </div>
        <div className="timer-actions">
          <button
            disabled={busy}
            onClick={async () => {
              if (state !== "disabled") {void run({action: "confirm"}); return;}
              setBusy(true); setNotice(""); setBypassReceipt(false);
              try {setActivation(await action({action: "review_activation"}));}
              catch (e) {setUrgent(true); setNotice(e instanceof Error ? e.message : "Bereitschaft nicht bestätigt.");}
              finally {setBusy(false);}
            }}
          >
            {state === "disabled"
              ? "Monatliche Prüfung aktivieren"
              : state === "awaiting" || state === "released"
                ? "Ich bin da – Versand stoppen"
                : "Ich bin noch da"}
          </button>
          {state !== "disabled" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run({ action: "disable" })}
            >
              {state === "awaiting" || state === "released"
                ? "Sofort stoppen & Prüfung pausieren"
                : "Prüfung pausieren"}
            </button>
          )}
          {(state === "awaiting" || state === "released") && (
            <small>
              „Ich bin da“ startet den nächsten Monatszyklus. „Pausieren“
              schaltet die Prüfung aus.
            </small>
          )}
        </div>
      </section>
      {activation && state === "disabled" && <section className="panel readiness" aria-label="Bereitschaft prüfen">
        <h2>Bereit für die monatliche Prüfung?</h2>
        <ul><li>Bestätigtes Konto: {activation.email}</li><li>Empfang im eigenen Postfach: {activation.received ? "ausdrücklich bestätigt" : "nicht bestätigt — SMTP-Annahme ist kein Empfang"}</li><li>{activation.releasedCount} freigegebene Nachrichten · {activation.draftCount} Entwürfe</li><li>Prüfjob aktuell · nächste Prüfmail: {date(activation.nextCheck)}</li></ul>
        <p>Sieben Tage Antwortfrist ab Mailserver-Annahme der Prüfmail. Eine ausbleibende Antwort beweist keinen Todesfall. Ohne Antwort können freigegebene Nachrichten versendet werden. Pausieren und „Ich bin da – Versand stoppen“ stoppen nur noch nicht begonnene Übergaben.</p>
        {!activation.received && <label className="checkbox"><input type="checkbox" checked={bypassReceipt} onChange={e => setBypassReceipt(e.target.checked)}/><span>Ich erkenne ausdrücklich das Risiko an, dass ich die Prüfmail nicht erhalte. Trotzdem ohne bestätigten Empfang aktivieren.</span></label>}
        <div className="actions"><button disabled={busy || (!activation.received && !bypassReceipt)} onClick={() => run({action: "activate", token: activation.token, confirmed: true, bypassReceipt})}>Jetzt monatliche Prüfung aktivieren</button><button className="secondary" disabled={busy} onClick={() => setActivation(null)}>Abbrechen · bleibt pausiert</button></div>
        <small>Für sicheren Empfang zuerst unten eine Testmail an dein eigenes Postfach senden und den Link dort bestätigen. Danach die Bereitschaft erneut prüfen.</small>
      </section>}
      <div className="dashboard-grid">
        <div>
          {editing ? (
            <Editor
              key={editing === "new" ? "new" : editing.id}
              message={editing === "new" ? undefined : editing}
              onSave={reload}
              onClose={() => {
                setEditing(null);
                requestAnimationFrame(() => document.getElementById(editorOrigin.current)?.focus());
                void reload();
              }}
            />
          ) : (
            <>
              <div className="section-heading">
                <h2>
                  Deine Nachrichten{" "}
                  <span className="count">{data.messages.length}</span>
                </h2>
                <button
                  id="new-message"
                  disabled={busy || state === "released"}
                  onClick={() => {editorOrigin.current="new-message"; setEditing("new");}}
                >
                  + Neue Nachricht
                </button>
              </div>
              {!data.messages.length && (
                <div className="empty">
                  <span className="symbol">✳</span>
                  <h2>Ein Anfang mit wenigen Worten.</h2>
                  <p>
                    Schreibe deine erste Nachricht. Sie bleibt ein Entwurf, bis
                    du sie freigibst.
                  </p>
                </div>
              )}
              {data.messages.map((message) => (
                <article className="message-card" key={message.id}>
                  <div className="section-heading">
                    <h3>{message.recipientName || "Noch kein Empfänger"}</h3>
                    <span
                      className={`badge ${message.status === "sent" ? "green" : ""}`}
                    >
                      {message.ready ? "Für Versand freigegeben" : "Entwurf"}
                    </span>
                  </div>
                  <p className="muted">
                    {message.recipientEmail || "E-Mail-Adresse fehlt"}
                  </p>
                  <p className="preview">
                    {message.body || "Hier ist noch Raum für deine Worte."}
                  </p>
                  <p className="muted">
                    {executionStatus(message, state, clock)}
                    {message.sent_at && <> · {date(message.sent_at)}</>}
                    {message.delivery_date && <small>{deliverySummary(message.delivery_date)}</small>}
                  </p>
                  <div className="actions">
                    {!!message.ready && message.status === "pending" && <button className="secondary" disabled={busy} onClick={() => run({action: "revoke", id: message.id})}>Freigabe widerrufen</button>}
                    {message.status === "pending" && (
                      <button
                        className="secondary"
                        disabled={busy || state === "released"}
                        id={`edit-${message.id}`}
                        onClick={() => {editorOrigin.current=`edit-${message.id}`; setEditing(message);}}
                      >
                        {message.ready ? "Freigabe ansehen" : "Bearbeiten & Freigabe prüfen"}
                      </button>
                    )}
                    {message.status === "failed" && (
                      <button
                        className="secondary"
                        disabled={busy || state === "released"}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Der Mailserver könnte diese Nachricht bereits angenommen haben. Erneut vormerken? Dabei kann eine doppelte Nachricht entstehen. Der Versand erfolgt erst nach einer neuen ausgebliebenen Lebensbestätigung.",
                            )
                          )
                            void run({
                              action: "retry",
                              id: message.id,
                              acceptDuplicateRisk: true,
                            });
                        }}
                      >
                        Erneut vormerken
                      </button>
                    )}
                    <button
                      className="text-button danger"
                      disabled={
                        busy ||
                        state === "released" ||
                        message.status === "sending"
                      }
                      onClick={() => {
                        if (
                          window.confirm("Diese Nachricht endgültig löschen?")
                        )
                          void run({ action: "delete", id: message.id });
                      }}
                    >
                      Löschen
                    </button>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>
        <aside>
          <section className="panel mail-status">
            <p className="eyebrow">MAILVERBINDUNG</p>
            <h3>Kommt deine Mail an?</h3>
            <p className="muted">Testziel: {data.user.email}</p>
            <p>
              {data.mailTest?.received_at
                ? `Empfang bestätigt: ${date(data.mailTest.received_at)}`
                : data.mailTest?.accepted_at
                  ? "Mailserver hat die Testmail angenommen. Empfang noch unbestätigt."
                  : data.mailTest
                    ? "Keine Mailserver-Annahme bestätigt: Versand läuft noch, ist unterbrochen oder fehlgeschlagen. Ereignisse prüfen; keine Empfangsbestätigung."
                    : "Noch kein Mailtest durchgeführt."}
            </p>
            <button
              className="secondary"
              disabled={
                busy ||
                (!!data.mailTest && clock - data.mailTest.requested_at < 60_000)
              }
              onClick={() => run({ action: "test_mail" })}
            >
              Testmail senden
            </button>
            <small>
              Bestätige den Link in der Testmail. Auch den Spamordner prüfen.
              Ein erfolgreicher Test garantiert keine spätere Zustellung.
            </small>
          </section>
          <details className="activity">
            <summary>Letzte Ereignisse ({data.events.length})</summary>
            {data.events.length ? (
              data.events.map((event, index) => (
                <p key={index}>
                  {labels[event.kind] || event.kind}
                  <small>{date(event.created_at)}</small>
                </p>
              ))
            ) : (
              <p className="muted">Deine Geschichte beginnt hier.</p>
            )}
          </details>
        </aside>
      </div>
    </section>
  );
}

function Account({
  data,
  onSave,
  onNotice,
}: {
  data: Data;
  onSave: () => void;
  onNotice: (value: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await authClient.updateUser({
        name: String(new FormData(e.currentTarget).get("name")),
      });
      if (result.error)
        throw new Error("Name konnte nicht gespeichert werden.");
      onSave();
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Änderung fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    if (
      !window.confirm(
        "Dein Konto mit allen Nachrichten endgültig löschen? Bereits versendete E-Mails und bestehende Backups bleiben erhalten.",
      )
    )
      return;
    setBusy(true);
    try {
      const result = await authClient.deleteUser({ password });
      if (result.error)
        throw new Error(
          "Konto konnte nicht gelöscht werden. Prüfe dein Passwort.",
        );
      window.location.assign("/");
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Löschen fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel account">
      <h2>Dein Konto</h2>
      <p>{data.user.email}</p>
      <form className="stack" onSubmit={update}>
        <label>
          Dein Name
          <input
            name="name"
            defaultValue={data.user.name}
            required
            maxLength={200}
          />
        </label>
        <button className="secondary" disabled={busy}>
          Name speichern
        </button>
      </form>
      <details>
        <summary className="danger">Konto endgültig löschen</summary>
        <form className="stack" onSubmit={remove}>
          <label>
            Aktuelles Passwort
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button disabled={busy} className="danger-button">
            Konto und Nachrichten löschen
          </button>
        </form>
      </details>
    </section>
  );
}
