import Link from "next/link";
export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">FÜR DIE MENSCHEN, DIE DIR WICHTIG SIND</p>
        <h1>
          Manche Worte
          <br />
          sollen <em>bleiben.</em>
        </h1>
        <p className="lead">
          Ein Dankeschön. Eine Erinnerung. Ein letzter Gruß.
          <br />
          Bewahre deine Worte auf – und bestimme, wann sie weitergehen.
        </p>
        <div className="actions">
          <Link className="button" href="/login">
            Deinen Nachklang schreiben ↗
          </Link>
          <Link className="quiet" href="/about">
            Wie funktioniert das?
          </Link>
        </div>
        <div className="hero-note">
          <span className="symbol">✳</span>
          <p>
            Deine Nachrichten bleiben bei dir.
            <br />
            <strong>Bis dein monatlicher Self Check ausbleibt.</strong>
          </p>
        </div>
      </section>
      <section className="steps">
        <article>
          <span>01 / SCHREIBEN</span>
          <h2>Was du sagen möchtest.</h2>
          <p>
            Schreibe persönliche Nachrichten und hinterlege für jede eine
            E-Mail-Adresse.
          </p>
        </article>
        <article>
          <span>02 / BESTÄTIGEN</span>
          <h2>Einmal im Monat melden.</h2>
          <p>
            Bestätige per E-Mail oder im Dashboard, dass du noch lebst. Du hast
            sieben Tage Zeit.
          </p>
        </article>
        <article>
          <span>03 / WEITERGEBEN</span>
          <h2>Worte finden ihren Weg.</h2>
          <p>
            Bleibt die Bestätigung aus, werden freigegebene Nachrichten
            versendet – optional erst ab einem späteren Datum.
          </p>
        </article>
      </section>
    </>
  );
}
