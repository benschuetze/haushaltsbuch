import { operatorInfo } from "~/lib/operator.server";
import type { Route } from "./+types/datenschutz";

export const meta: Route.MetaFunction = () => [{ title: "Datenschutz · Haushaltsbuch" }];

export function loader() {
  const o = operatorInfo();
  return { contact: o.email, operator: o.name ? [o.name, ...o.address].join(", ") : null };
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
          beaufsichtigt von der finnischen Finanzaufsicht FIN-FSA). Die öffentliche Demo hat keine Bankanbindung und
          enthält erfundene Daten. Was Besucher dort eingeben oder hochladen, sehen alle anderen Besucher auch; es wird
          jede Nacht gelöscht. Deshalb dort keine echten Kontoauszüge hochladen.
        </li>
        <li>Eigene Einstellungen: Kategorien, Regeln, Budgets.</li>
        <li>
          Ein Anmelde-Cookie (technisch notwendig) und gehashte IP-Adressen fehlgeschlagener Anmeldungen (24 Stunden).
        </li>
      </ul>
      <h2 className="text-lg font-semibold">Wo die Daten liegen</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Datenbank: Neon (Region Frankfurt). Von der Bankanbindung speichert die App nur die Sitzungskennung des
          Kontoinformationsdienstes, verschlüsselt (AES-256-GCM). Bank-Passwort und PIN sieht die App nie; die Anmeldung
          läuft direkt bei der Bank.
        </li>
        <li>Anwendung: Vercel (Region Frankfurt).</li>
        <li>
          Kategorisierung: Gegenpartei, Verwendungszweck, Betrag und Datum einzelner Buchungen gehen an Anthropic (USA)
          zur automatischen Zuordnung. IBANs werden vorher entfernt. Kontonummern und Zugangsdaten werden nie
          übermittelt.
        </li>
        <li>Fragen an den Assistenten gehen ebenfalls an Anthropic; die Antwort nutzt Zahlen aus deinen Buchungen.</li>
        <li>
          Übermittlung in die USA: Grundlage sind die EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO), die
          Anthropic in seinem Auftragsverarbeitungsvertrag (Data Processing Addendum zu den Commercial Terms)
          vereinbart. Laut diesen Bedingungen trainiert Anthropic keine Modelle mit Inhalten aus der API-Nutzung.
        </li>
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
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Buchungen, Kategorien, Budgets, Ziele und die Bankanbindung: Art. 6 Abs. 1 lit. b DSGVO, weil die App genau
          dafür genutzt wird. Ohne diese Daten gibt es keine Übersicht.
        </li>
        <li>
          Automatische Zuordnung und Assistent über Anthropic: ebenfalls Art. 6 Abs. 1 lit. b DSGVO. Was eigene Regeln
          oder die eingebaute Händlerliste schon zuordnen, geht gar nicht erst an das Modell.
        </li>
        <li>
          Anmelde-Cookie und gehashte IP-Adressen fehlgeschlagener Anmeldungen: Art. 6 Abs. 1 lit. f DSGVO, berechtigtes
          Interesse am Schutz des Zugangs vor Passwort-Raten. Das Cookie ist technisch notwendig (§ 25 Abs. 2 Nr. 2
          TDDDG) und braucht keine Einwilligung.
        </li>
      </ul>
      <h2 className="text-lg font-semibold">Speicherdauer und Rechte</h2>
      <p>
        Daten bleiben gespeichert, bis sie gelöscht werden. Der Zugriff auf Bankkonten endet spätestens nach 180 Tagen
        und kann jederzeit in der App (unter „Banken“ beim verbundenen Konto „Trennen“) oder bei der Bank widerrufen
        werden. Es bestehen die Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und
        Widerspruch (Art. 15–21 DSGVO) sowie das Beschwerderecht bei einer Datenschutzaufsichtsbehörde.
      </p>
    </article>
  );
}
