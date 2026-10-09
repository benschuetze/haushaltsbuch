import type { Route } from "./+types/nutzungsbedingungen";

export const meta: Route.MetaFunction = () => [{ title: "Nutzungsbedingungen · Haushaltsbuch" }];

export default function Nutzungsbedingungen() {
  return (
    <article className="max-w-2xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Nutzungsbedingungen</h1>
      <p>
        Das Haushaltsbuch ist eine private Anwendung ohne kommerzielles Angebot. Sie wird vom Betreiber ausschließlich
        für die eigenen Konten genutzt; ein Zugang für Dritte besteht nicht.
      </p>
      <p>
        Die App liest Kontoumsätze nur lesend. Sie löst keine Zahlungen aus. Die automatische Kategorisierung und die
        Spar-Hinweise sind Hilfen ohne Gewähr und keine Finanz-, Steuer- oder Anlageberatung.
      </p>
      <p>
        Die öffentliche Demo zeigt ausschließlich erfundene Beispieldaten und nimmt keine Eingaben an. Der Quellcode ist
        auf GitHub einsehbar.
      </p>
    </article>
  );
}
