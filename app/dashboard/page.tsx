"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { authClient } from "../../lib/auth-client";

type Message = {
  id: string;
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
type Draft = {
  recipientName: string;
  recipientEmail: string;
  body: string;
  deliveryDate: string;
  ready: boolean;
};
const date = (time: number | null) =>
  time
    ? new Date(time).toLocaleString("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const labels: Record<string, string> = {
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

async function action(input: Record<string, unknown>) {
  const response = await fetch("/api/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Aktion fehlgeschlagen.");
  return data as { ok: boolean; id?: string };
}

function Editor({
  message,
  onClose,
  onSave,
}: {
  message?: Message;
  onClose: () => void;
  onSave: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    recipientName: message?.recipientName || "",
    recipientEmail: message?.recipientEmail || "",
    body: message?.body || "",
    deliveryDate: message?.delivery_date || "",
    ready: !!message?.ready,
  });
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("Noch keine Änderung.");
  const savedId = useRef(message?.id);
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const persist = useCallback(
    (snapshot: Draft) => {
      const next = queue.current
        .catch(() => {})
        .then(async () => {
          if (alive.current) setStatus("Wird gespeichert …");
          const result = await action({
            action: "save",
            id: savedId.current,
            ...snapshot,
          });
          savedId.current = result.id;
          if (alive.current) {
            if (currentDraft.current === snapshot) setStatus("Gespeichert");
            onSave();
          }
        });
      queue.current = next;
      return next;
    },
    [onSave],
  );
  useEffect(() => {
    if (!dirty) return;
    timer.current = setTimeout(() => {
      persist(draft).catch((error) => {
        if (alive.current) setStatus(error.message);
      });
    }, 800);
    return () => clearTimeout(timer.current);
  }, [draft, dirty, persist]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty || status === "Gespeichert") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, status]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDirty(true);
    setStatus("Ungespeicherte Änderung …");
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function finish(e: FormEvent) {
    e.preventDefault();
    clearTimeout(timer.current);
    try {
      if (dirty) await persist(draft);
      onClose();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Speichern fehlgeschlagen.",
      );
    }
  }
  return (
    <section className="panel editor">
      <div className="section-heading">
        <h2>{message ? "Deine Nachricht" : "Ein neuer Nachklang"}</h2>
        <span role="status" className="muted">
          {status}
        </span>
      </div>
      <form className="stack" onSubmit={finish}>
        <div className="field-grid">
          <label>
            Für wen?
            <input
              value={draft.recipientName}
              maxLength={200}
              onChange={(e) => change("recipientName", e.target.value)}
              placeholder="Name"
            />
          </label>
          <label>
            E-Mail-Adresse
            <input
              value={draft.recipientEmail}
              type="email"
              maxLength={254}
              onChange={(e) => change("recipientEmail", e.target.value)}
              placeholder="name@beispiel.de"
            />
          </label>
        </div>
        <label>
          Deine Worte
          <textarea
            rows={12}
            value={draft.body}
            maxLength={100_000}
            onChange={(e) => change("body", e.target.value)}
            placeholder="Was möchtest du diesem Menschen mitgeben?"
          />
        </label>
        <label>
          Optional: frühestens versenden ab
          <input
            type="date"
            value={draft.deliveryDate}
            onChange={(e) => change("deliveryDate", e.target.value)}
          />
          <small>
            Erst nach ausgebliebenem Self Check. Das Datum wird in UTC
            ausgewertet.
          </small>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.ready}
            onChange={(e) => change("ready", e.target.checked)}
          />
          <span>Diese Nachricht für den automatischen Versand freigeben.</span>
        </label>
        <p className="muted">
          Ohne Freigabe bleibt sie ein Entwurf. Änderungen werden nach einer
          kurzen Pause automatisch gespeichert.
        </p>
        <button type="submit">Speichern & zurück</button>
      </form>
    </section>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [notice, setNotice] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Message | "new" | null>(null);
  const [account, setAccount] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [refreshed, setRefreshed] = useState<number | null>(null);
  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok)
        throw new Error("Dashboard konnte nicht geladen werden.");
      setData(await response.json());
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
    try {
      await action(input);
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
        <p role="alert" className="notice">
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
          <p className="eyebrow">LEBENSTIMER / MONATLICHER SELF CHECK</p>
          <h2>
            {state === "awaiting"
              ? "Dein Countdown läuft."
              : state === "released"
                ? "Versand ist freigegeben."
                : state === "disabled"
                  ? "Dein Timer ist pausiert."
                  : "Alles im grünen Bereich."}
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
            onClick={() => {
              if (
                state !== "disabled" ||
                window.confirm(
                  "Monatliche Prüfung aktivieren? Nach einer unbeantworteten Prüfmail werden deine freigegebenen Nachrichten nach sieben Tagen versendet. Bitte teste vorher den Mailempfang.",
                )
              )
                void run({ action: "confirm" });
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
      <div className="dashboard-grid">
        <div>
          {editing ? (
            <Editor
              key={editing === "new" ? "new" : editing.id}
              message={editing === "new" ? undefined : editing}
              onSave={reload}
              onClose={() => {
                setEditing(null);
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
                  disabled={busy || state === "released"}
                  onClick={() => setEditing("new")}
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
                      {message.status === "sent"
                        ? "Versendet"
                        : message.status === "failed"
                          ? "Versand unklar / fehlgeschlagen"
                          : message.status === "sending"
                            ? "Versand läuft"
                            : message.ready
                              ? "Freigegeben"
                              : "Entwurf"}
                    </span>
                  </div>
                  <p className="muted">
                    {message.recipientEmail || "E-Mail-Adresse fehlt"}
                  </p>
                  <p className="preview">
                    {message.body || "Hier ist noch Raum für deine Worte."}
                  </p>
                  <p className="muted">
                    {message.sent_at
                      ? `Vom Mailserver angenommen: ${date(message.sent_at)}`
                      : message.delivery_date
                        ? `Frühestens ab ${message.delivery_date}, nach Versandfreigabe`
                        : "Nach ausgebliebener Lebensbestätigung"}
                  </p>
                  <div className="actions">
                    {message.status === "pending" && (
                      <button
                        className="secondary"
                        disabled={busy || state === "released"}
                        onClick={() => setEditing(message)}
                      >
                        Bearbeiten
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
                    ? "Testmail fehlgeschlagen oder noch im Versand."
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
          <section className="activity">
            <h3>Letzte Ereignisse</h3>
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
          </section>
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
