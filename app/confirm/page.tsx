export const dynamic = "force-dynamic";
export default async function Confirm({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; result?: string }>;
}) {
  const { token, result } = await searchParams;
  return (
    <section className="narrow">
      <p className="eyebrow">DEIN MONATLICHER SELF CHECK</p>
      <h1>
        {result === "ok"
          ? "Schön, dass du da bist."
          : "Ein kleines Lebenszeichen."}
      </h1>
      <div className="panel stack">
        {result === "ok" ? (
          <p>
            Deine Bestätigung ist gespeichert. Die nächste Prüfung folgt in
            einem Monat. Noch nicht begonnene Versandaufträge sind gestoppt.
          </p>
        ) : result === "invalid" || !token || !/^[a-f0-9]{64}$/.test(token) ? (
          <p>
            Dieser Link ist ungültig oder wurde bereits verwendet. Du kannst
            deine Bestätigung im Dashboard abgeben.
          </p>
        ) : (
          <>
            <p>
              Bestätige, dass du noch lebst. Damit beginnt dein monatlicher
              Prüfzeitraum erneut und der ausstehende Versand wird gestoppt.
            </p>
            <form method="post" action="/api/confirm">
              <input type="hidden" name="token" value={token} />
              <button>Ja, ich bin noch da</button>
            </form>
            <small>Das bloße Öffnen dieser Seite bestätigt noch nichts.</small>
          </>
        )}
        <a href="/dashboard">Zum Dashboard ↗</a>
      </div>
    </section>
  );
}
