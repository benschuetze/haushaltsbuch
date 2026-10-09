import { Amount } from "~/components/amount";
import type { CategoryTotal } from "~/lib/queries";

/** Bars are sized against the largest entry so the eye compares categories, not absolute euros. */
export function CategoryBars({ items, label }: { items: CategoryTotal[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.cents)));
  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((item) => (
        <li key={item.categoryId ?? "none"} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {item.name} <span className="text-muted-foreground">({item.count})</span>
            </span>
            <Amount cents={item.cents} />
          </div>
          <div className="h-2 rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-2 rounded-full"
              style={{ width: `${(Math.abs(item.cents) / max) * 100}%`, backgroundColor: item.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
