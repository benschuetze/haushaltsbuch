import { formatCents } from "~/lib/money";
import { cn } from "~/lib/utils";

export function Amount({ cents, className }: { cents: number; className?: string }) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", cents > 0 && "text-emerald-700", className)}>
      {formatCents(cents)}
    </span>
  );
}
