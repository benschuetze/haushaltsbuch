import { imprintComplete, operatorInfo } from "~/lib/operator.server";
import type { Route } from "./+types/impressum";

export const meta: Route.MetaFunction = () => [{ title: "Impressum · Haushaltsbuch" }];

export function loader() {
  const operator = operatorInfo();
  return { operator, complete: imprintComplete(operator) };
}

export default function Impressum({ loaderData }: Route.ComponentProps) {
  const { operator, complete } = loaderData;
  return (
    <article className="max-w-2xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Impressum</h1>
      <h2 className="text-lg font-semibold">Angaben nach § 5 DDG</h2>
      {complete ? (
        <address className="not-italic" data-testid="imprint-operator">
          {operator.name}
          {operator.address.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
          <span className="block">
            E-Mail: <a href={`mailto:${operator.email}`}>{operator.email}</a>
          </span>
        </address>
      ) : (
        // Honest about the gap instead of showing a placeholder that reads like real details.
        <p role="status" data-testid="imprint-missing">
          Für diese Instanz sind noch keine Angaben zum Betreiber hinterlegt (Name, Anschrift, E-Mail).
        </p>
      )}
      <h2 className="text-lg font-semibold">Hinweis</h2>
      <p>
        Das Haushaltsbuch ist eine private, nicht kommerzielle Anwendung.
        {complete && " Inhaltlich verantwortlich ist die oben genannte Person."}
      </p>
    </article>
  );
}
