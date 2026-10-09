import { cn } from "~/lib/utils";

export type LogoTile = { id: string; name: string };

/** The institution's own app icon (public/logos), on white so wordmarks and square icons sit alike. */
export function BankLogo({ tile, className }: { tile: LogoTile; className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-2xl border bg-white shadow-sm",
        className,
      )}
      aria-hidden="true"
    >
      <img
        src={`/logos/${tile.id}.png`}
        alt=""
        width={128}
        height={128}
        loading="lazy"
        className="size-full object-contain"
      />
    </span>
  );
}
