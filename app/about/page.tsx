export default function About() {
  return (
    <section className="narrow prose">
      <p className="eyebrow">MIT BEDACHT BEWAHREN</p>
      <h1>Wie Nachklang funktioniert.</h1>
      <h2>Du bestimmst, was weitergeht.</h2>
      <p>
        Nachrichten werden automatisch als Entwurf gespeichert. Erst wenn du
        eine Nachricht ausdrücklich freigibst und den Self Check aktivierst,
        kann sie versendet werden. Ein optionales Datum verschiebt den Versand
        bis mindestens zu diesem Tag (UTC).
      </p>
      <h2>Ein Monat. Sieben Tage Antwortzeit.</h2>
      <p>
        Nach deiner Bestätigung beginnt ein neuer Kalendermonat. Danach erhältst
        du eine E-Mail. Bleibt deine Bestätigung sieben Tage aus, werden
        freigegebene Nachrichten verschickt. Eine ausbleibende Antwort beweist
        keinen Todesfall.
      </p>
      <p>
        Du kannst jederzeit im Dashboard bestätigen oder die Prüfung
        deaktivieren. Bereits an den Mailserver übergebene Nachrichten können
        nicht zurückgerufen werden.
      </p>
      <h2>Countdown und Mailempfang im Blick.</h2>
      <p>
        Das Dashboard zeigt Beginn, Ende und Restzeit des Countdowns. Mit „Ich
        bin da – Versand stoppen“ setzt du die Prüfung auf den nächsten Monat
        zurück. „Sofort stoppen & Prüfung pausieren“ schaltet sie aus. Noch
        nicht begonnene Sendungen werden dabei gestoppt.
      </p>
      <p>
        Der Countdown beginnt erst nach Annahme der Prüfmail durch den
        Mailserver. Nach drei und sechs Tagen folgen Erinnerungen. Scheitert
        eine Erinnerung beim Versand, pausiert die Prüfung. Über „Testmail
        senden“ kannst du den Empfang im eigenen Postfach ausdrücklich
        bestätigen; ein Mailtest verändert den Lebenstimer nicht. SMTP-Annahme
        und ein erfolgreicher Test garantieren keine zukünftige Zustellung ins
        Postfach.
      </p>
      <h2>Deine Daten.</h2>
      <p>
        Nachrichtentexte und Empfängerdaten sind in der Datenbank mit
        AES-256-GCM verschlüsselt. Der Server besitzt den Schlüssel und kann sie
        zum Versand entschlüsseln. Das ist keine Ende-zu-Ende-Verschlüsselung.
        Kontodaten, Termine und Versandstatus werden für den Betrieb
        gespeichert.
      </p>
      <p>
        Beim Versand erhält der konfigurierte SMTP-Anbieter den Nachrichtentext
        und die E-Mail-Adresse. Nachklang nutzt keine Analyse- oder
        Werbedienste. Für den Login wird ein notwendiges Sitzungscookie
        verwendet. Deine Auswahl zwischen hellem und dunklem Modus wird lokal im
        Browser gespeichert.
      </p>
      <h2>Ausfälle und Versandfehler.</h2>
      <p>
        Nach mehr als einer Stunde ohne Prüfjob werden ausstehende Prüfungen und
        Versandfreigaben zurückgesetzt. Zuerst wird erneut eine
        Lebensbestätigung angefordert. Bei unklarem Versandstatus erfolgt keine
        automatische Wiederholung. Bereits versendete Nachrichten bleiben als
        versendet markiert.
      </p>
      <h2>Daten löschen.</h2>
      <p>
        Nachrichten können einzeln gelöscht werden. Über die Kontoeinstellungen
        lassen sich das Konto und seine Daten entfernen. Bestehende Sicherungen
        werden dadurch nicht nachträglich verändert.
      </p>
      <p className="notice">
        Dies ist die technische Beschreibung dieser selbst gehosteten App. Vor
        einer öffentlichen Nutzung muss der Betreiber seine Kontaktdaten und die
        konkrete Datenschutzerklärung ergänzen.
      </p>
    </section>
  );
}
