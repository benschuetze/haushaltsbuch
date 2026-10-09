import { Badge } from "~/components/ui/badge";
import { formatPercent } from "~/lib/format";

type Props = {
  source: "rule" | "ai" | "manual" | null;
  confidence: number | null;
  needsReview: boolean;
};

export function SourceBadges({ source, confidence, needsReview }: Props) {
  return (
    <span className="flex flex-wrap gap-1">
      {needsReview ? <Badge className="bg-amber-200 text-amber-950 hover:bg-amber-200">prüfen</Badge> : null}
      {source === "rule" ? <Badge variant="secondary">Regel</Badge> : null}
      {source === "manual" ? <Badge variant="secondary">manuell</Badge> : null}
      {source === "ai" ? (
        <Badge variant="outline">KI{confidence !== null ? ` ${formatPercent(confidence)}` : ""}</Badge>
      ) : null}
    </span>
  );
}
