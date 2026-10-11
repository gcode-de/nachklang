"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DraftSaver } from "../../lib/draft-saver";
import { action } from "../../lib/browser-action";
import { deliverySummary } from "../../lib/message-status";
export type EditableMessage = {id: string; revision: number; recipientName: string; recipientEmail: string; body: string; delivery_date: string | null; ready: number};
type Draft = {recipientName: string; recipientEmail: string; body: string; deliveryDate: string};
type Review = {id: string; token: string; recipientName: string; recipientEmail: string; deliveryDate: string | null; checkState: string; deadline: number | null};
export default function Editor({message, onClose, onSave}: {message?: EditableMessage; onClose: () => void; onSave: () => void}) {
  const [draft, setDraft] = useState<Draft>({recipientName: message?.recipientName || "", recipientEmail: message?.recipientEmail || "", body: message?.body || "", deliveryDate: message?.delivery_date || ""});
  const [status, setStatus] = useState("Noch keine Änderung.");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(!!message?.ready);
  const heading = useRef<HTMLHeadingElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const words = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const saver = useRef<DraftSaver | null>(null);
  if (!saver.current) saver.current = new DraftSaver(action, value => { if (alive.current) setStatus(value); }, message?.id, message?.revision);
  useEffect(() => { alive.current = true; heading.current?.focus(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (armed || !saver.current!.unsaved || busy || review) return;
    const timer = setTimeout(() => { void saver.current!.save(draft).then(onSave).catch(() => {}); }, 800);
    return () => clearTimeout(timer);
  }, [draft, armed, busy, review, onSave]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (saver.current!.unsaved) {event.preventDefault(); event.returnValue = "";} };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const emailError = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.recipientEmail.trim()) ? "Für die Freigabe ist eine vollständige E-Mail-Adresse nötig. Der Entwurf wird trotzdem gespeichert." : "";
  const nameError = !draft.recipientName.trim() ? "Für die Freigabe bitte einen Empfängernamen eintragen." : "";
  const bodyError = !draft.body.trim() ? "Für die Freigabe bitte deine Worte eintragen." : "";
  function change(key: keyof Draft, value: string) { const next = {...draft, [key]: value}; saver.current!.change(next); setDraft(next); setError(""); }
  async function finish(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { if (saver.current!.unsaved) await saver.current!.save(draft); onSave(); onClose(); }
    catch { /* DraftSaver preserves text and reports the error. */ }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (nameError || emailError || bodyError) { setError("Die Freigabe benötigt vollständige Angaben. Dein Entwurf bleibt erhalten."); (nameError ? name.current : emailError ? email.current : words.current)?.focus(); return; }
    setBusy(true); setError("");
    try {
      if (saver.current!.unsaved || !saver.current!.id) { saver.current!.change(draft); await saver.current!.save(draft); onSave(); }
      setReview(await action<Review>({action: "review_release", id: saver.current!.id}));
      heading.current?.focus();
    } catch (e) { setError(e instanceof Error ? e.message : "Freigabeprüfung fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  async function authorize() {
    if (!review) return;
    setBusy(true); setError("");
    try {
      await action({action: "release", id: review.id, token: review.token, confirmed: true});
      setArmed(true); setReview(null); setStatus("Freigabe vom Server bestätigt."); onSave();
    } catch (e) { setError(`Freigabe nicht bestätigt. ${e instanceof Error ? e.message : "Bitte neu prüfen."} Bei Verbindungsabbruch kann die Serveraktion bereits erfolgt sein; erneut bestätigen ist sicher, nicht einfach weiterbearbeiten.`); }
    finally {setBusy(false);}
  }
  async function revoke() {
    setBusy(true); setError("");
    try { await action({action: "revoke", id: saver.current!.id}); onSave(); onClose(); }
    catch (e) {setError(e instanceof Error ? e.message : "Widerruf nicht bestätigt.");}
    finally {setBusy(false);}
  }
  return <section className="panel editor">
    <div className="section-heading"><h2 ref={heading} tabIndex={-1}>{message ? "Deine Nachricht" : "Ein neuer Nachklang"}</h2><span role="status" aria-live="polite" className="muted">{status}</span></div>
    {error && <p role="alert" className="notice">{error}</p>}
    <p className="badge">{armed ? "Für Versand freigegeben — Inhalt gesperrt" : "Entwurf — kein automatischer Versand"}</p>
    {armed && <p>Eine pausierte Prüfung widerruft diese Freigabe nicht. Widerrufe sie vor einer Bearbeitung. Bereits begonnene Sendungen sind nicht zurückrufbar.</p>}
    {armed && <button className="secondary" disabled={busy} onClick={revoke}>Zurück zum Entwurf · Freigabe widerrufen</button>}
    <form className="stack" onSubmit={finish} noValidate>
      <fieldset disabled={busy || armed || !!review} className="editor-fields">
        <div className="field-grid">
          <label>Für wen?<input ref={name} name="recipientName" autoComplete="off" value={draft.recipientName} maxLength={200} aria-invalid={!!nameError} aria-describedby="name-help" onChange={e => change("recipientName", e.target.value)} placeholder="Name"/><small id="name-help">{nameError || "Name der Person, für die du schreibst."}</small></label>
          <label>E-Mail-Adresse<input ref={email} name="recipientEmail" autoComplete="off" spellCheck={false} type="email" value={draft.recipientEmail} maxLength={254} aria-invalid={!!emailError} aria-describedby="email-help" onChange={e => change("recipientEmail", e.target.value)} placeholder="name@beispiel.de"/><small id="email-help">{emailError || "An diese Adresse würde die freigegebene Nachricht übergeben."}</small></label>
        </div>
        <label>Deine Worte<textarea ref={words} name="body" autoComplete="off" rows={12} value={draft.body} maxLength={100_000} aria-invalid={!!bodyError} aria-describedby="body-help" onChange={e => change("body", e.target.value)} placeholder="Was möchtest du diesem Menschen mitgeben?"/><small id="body-help">{bodyError || "Nur auf dieser Instanz gespeichert, nicht im Browserspeicher."}</small></label>
        <label>Optional: frühestens versenden ab<input name="deliveryDate" type="date" value={draft.deliveryDate} aria-describedby="date-help" onChange={e => change("deliveryDate", e.target.value)}/><small id="date-help">{deliverySummary(draft.deliveryDate || null)}</small></label>
      </fieldset>
      <p className="muted">Änderungen werden nach einer kurzen Pause als Entwurf gespeichert. Speichern und Zurückgehen erteilen keine Freigabe.</p>
      <div className="actions"><button type="submit" disabled={busy || !!review}>{armed ? "Zurück" : "Entwurf speichern & zurück"}</button>{!armed && <button type="button" className="secondary" disabled={busy || !!review} onClick={() => { saver.current!.change(draft); void saver.current!.save(draft).then(onSave).catch(() => {}); }}>Speichern erneut versuchen</button>}{!armed && <button type="button" className="secondary" disabled={busy || !!review} aria-describedby="release-help" onClick={prepare}>Freigabe prüfen</button>}</div>
      {!armed && <small id="release-help">Freigabe benötigt Name, vollständige E-Mail-Adresse und Nachricht. Erst die nachfolgende ausdrückliche Bestätigung erteilt Versandberechtigung.</small>}
    </form>
    {review && <section className="release-review" aria-label="Freigabe prüfen">
      <h3>Diese gespeicherte Nachricht freigeben?</h3><p><strong>{review.recipientName}</strong><br/>{review.recipientEmail}</p><p>{deliverySummary(review.deliveryDate)}</p>
      <p>{review.checkState === "disabled" ? "Die Prüfung ist pausiert. Freigabe allein aktiviert sie nicht." : review.checkState === "awaiting" ? `Die Antwortfrist läuft bereits: ${new Date(review.deadline!).toLocaleString("de-DE")} (lokale Zeitzone).` : "Die monatliche Prüfung ist aktiv. Ohne Antwort innerhalb von sieben Tagen kann der Versand starten."}</p>
      <p>Begonnene Sendungen können nicht zurückgerufen werden. Eine ausbleibende Antwort beweist keinen Todesfall. Die Freigabe gilt für genau diesen gespeicherten Inhalt.</p>
      <div className="actions"><button disabled={busy} onClick={authorize}>Jetzt ausdrücklich für automatischen Versand freigeben</button><button className="secondary" disabled={busy} onClick={() => {setReview(null); heading.current?.focus();}}>Abbrechen · bleibt Entwurf</button></div>
    </section>}
  </section>;
}
