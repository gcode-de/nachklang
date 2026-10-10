export const dynamic = "force-dynamic";
export default async function Confirm({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; result?: string; kind?: string }>;
}) {
  const { token, result, kind } = await searchParams;
  const mail = kind === "mail";
  return (
    <section className="narrow">
      <p className="eyebrow">
        {mail ? "DEIN MAILTEST" : "DEIN MONATLICHEN SELF CHECK"}
      </p>
      <h1>
        {mail
          ? result === "ok"
            ? "Mail angekommen."
            : "Ein Test für dein Postfach."
          : result === "ok"
            ? "Schön, dass du da bist."
            : "Ein kleines Lebenszeichen."}
      </h1>
      <div className="panel stack">
        {result === "ok" ? (
          <p>
            {mail
              ? "Der Empfang deiner Testmail ist bestätigt. Dein Lebenstimer wurde dadurch nicht verändert."
              : "Deine Bestätigung ist gespeichert. Die nächste Prüfung folgt in einem Monat. Noch nicht begonnene Versandaufträge sind gestoppt."}
          </p>
        ) : result === "invalid" || !token || !/^[a-f0-9]{64}$/.test(token) ? (
          <p>
            Dieser Link ist ungültig oder wurde bereits verwendet. Du kannst
            deine Bestätigung im Dashboard abgeben.
          </p>
        ) : (
          <>
            <p>
              {mail
                ? "Bestätige, dass du diese Testmail erhalten hast. Das verändert deinen Lebenstimer nicht."
                : "Bestätige, dass du noch lebst. Damit beginnt dein monatlicher Prüfzeitraum erneut und der ausstehende Versand wird gestoppt."}
            </p>
            <form method="post" action="/api/confirm">
              <input type="hidden" name="kind" value={mail ? "mail" : "life"} />
              <input type="hidden" name="token" value={token} />
              <button>
                {mail ? "Testmail erhalten" : "Ja, ich bin noch da"}
              </button>
            </form>
            <small>Das bloße Öffnen dieser Seite bestätigt noch nichts.</small>
          </>
        )}
        <a href="/dashboard">Zum Dashboard ↗</a>
      </div>
    </section>
  );
}
