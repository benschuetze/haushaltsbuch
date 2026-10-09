import { cn } from "~/lib/utils";

export type LogoTile = { id: string; name: string; mark: string; bg: string; fg: string };

/** Monogram in brand colours; PayPal gets its overlapping double P on white. */
export function BankLogo({ tile, className }: { tile: LogoTile; className?: string }) {
  if (tile.id === "paypal") {
    return (
      <span
        className={cn("flex items-center justify-center rounded-2xl border bg-white shadow-sm", className)}
        aria-hidden="true"
      >
        <svg viewBox="0 0 48 48" className="size-3/4" role="presentation">
          <text
            x="9"
            y="38"
            fontSize="36"
            fontWeight="800"
            fontStyle="italic"
            fontFamily="Arial, sans-serif"
            fill="#009cde"
          >
            P
          </text>
          <text
            x="14"
            y="33"
            fontSize="36"
            fontWeight="800"
            fontStyle="italic"
            fontFamily="Arial, sans-serif"
            fill="#003087"
          >
            P
          </text>
        </svg>
      </span>
    );
  }
  const size = tile.mark.length >= 4 ? "text-[0.8rem]" : tile.mark.length === 3 ? "text-base" : "text-xl";
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-2xl font-extrabold tracking-tight shadow-sm",
        size,
        className,
      )}
      style={{ backgroundColor: tile.bg, color: tile.fg }}
      aria-hidden="true"
    >
      {tile.mark}
    </span>
  );
}
