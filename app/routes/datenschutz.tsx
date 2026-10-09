import type { Route } from "./+types/datenschutz";

export const meta: Route.MetaFunction = () => [{ title: "Datenschutz · Haushaltsbuch" }];

export function loader() {
  return {
    contact: process.env.PRIVACY_CONTACT_EMAIL?.trim() || null,
    operator: process.env.PRIVACY_OPERATOR?.trim() || null,
  };
}

export default function Datenschutz({ loaderData }: Route.ComponentProps) {
  const { contact, operator } = loaderData;
  return (
    <article className="prose max-w-2xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Datenschutzerklärung</h1>
      <p>
        Das Haushaltsbuch ist eine private, nicht kommerzielle Anwendung zur Verwaltung der eigenen Finanzen. Sie wird
        von einer einzelnen Person für ihre eigenen Konten betrieben.
      </p>
      <h2 className="text-lg font-semibold">Verantwortlich</h2>
      <p>
        {operator ?? "Der Betreiber dieser Instanz"}
        {contact ? (
          <>
            , erreichbar unter <a href={`mailto:${contact}`}>{contact}</a>
          </>
        ) : null}
        .
      </p>
      <h2 className="text-lg font-semibold">Welche Daten verarbeitet werden</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Kontoumsätze (Datum, Betrag, Gegenpartei, Verwendungszweck) aus hochgeladenen Kontoauszügen oder, nach
          ausdrücklicher Freigabe bei der Bank, über den Kontoinformationsdienst Enable Banking Oy (Espoo, Finnland;
          beaufsichtigt von der finnischen Finanzaufsicht FIN-FSA).
        </li>
        <li>Eigene Einstellungen: Kategorien, Regeln, Budgets.</li>
        <li>
          Ein Anmelde-Cookie (technisch notwendig) und gehashte IP-Adressen fehlgeschlagener Anmeldungen (24 Stunden).
        </li>
      </ul>
      <h2 className="text-lg font-semibold">Wo die Daten liegen</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Datenbank: Neon (Region Frankfurt). Zugangsdaten zur Bank werden verschlüsselt gespeichert.</li>
        <li>Anwendung: Vercel (Region Frankfurt).</li>
        <li>
          Kategorisierung: Gegenpartei, Verwendungszweck, Betrag und Datum einzelner Buchungen gehen an Anthropic (USA)
          zur automatischen Zuordnung. IBANs werden vorher entfernt. Kontonummern und Zugangsdaten werden nie
          übermittelt.
        </li>
        <li>Fragen an den Assistenten gehen ebenfalls an Anthropic; die Antwort nutzt Zahlen aus deinen Buchungen.</li>
        <li>
          Spracheingabe (Mikrofon-Knopf, freiwillig): Die Erkennung übernimmt dein Browser bzw. dessen Hersteller (z. B.
          Apple bei Safari, Google bei Chrome). Das Haushaltsbuch erhält nur den erkannten Text, keine Audioaufnahme.
        </li>
      </ul>
      <h2 className="text-lg font-semibold">Zweck und Rechtsgrundlage</h2>
      <p>
        Ausschließlich die eigene Haushaltsführung. Keine Weitergabe an Dritte zu Werbe- oder sonstigen Zwecken, kein
        Tracking, keine Analyse-Cookies.
      </p>
      <h2 className="text-lg font-semibold">Speicherdauer und Rechte</h2>
      <p>
        Daten bleiben gespeichert, bis sie gelöscht werden. Der Zugriff auf Bankkonten endet spätestens nach 180 Tagen
        und kann jederzeit in der App („Banken“ → „Trennen“) oder bei der Bank widerrufen werden. Es bestehen die Rechte
        auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO)
        sowie das Beschwerderecht bei einer Datenschutzaufsichtsbehörde.
      </p>
    </article>
  );
}
