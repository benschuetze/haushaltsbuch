import { cn } from "~/lib/utils";

/** Budget bar in e-ink: solid ink below 80 %, dithered up to 100 %, red beyond. The text carries the numbers. */
export function BudgetBar({ spent, budget, label }: { spent: number; budget: number; label: string }) {
  const ratio = budget > 0 ? spent / budget : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(ratio * 100))}
      className="h-3 border-2 border-foreground"
    >
      <div
        className={cn("h-full", ratio > 1 ? "bg-red-700" : ratio >= 0.8 ? "dither text-foreground" : "bg-foreground")}
        style={{ width: `${Math.min(100, ratio * 100)}%` }}
      />
    </div>
  );
}
