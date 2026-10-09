import { cn } from "~/lib/utils";

/** Budget bar: green below 80 %, amber up to 100 %, red beyond. The text next to it carries the numbers. */
export function BudgetBar({ spent, budget, label }: { spent: number; budget: number; label: string }) {
  const ratio = budget > 0 ? spent / budget : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(ratio * 100))}
      className="h-2 rounded-full bg-muted"
    >
      <div
        className={cn("h-2 rounded-full", ratio > 1 ? "bg-red-600" : ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-600")}
        style={{ width: `${Math.min(100, ratio * 100)}%` }}
      />
    </div>
  );
}
