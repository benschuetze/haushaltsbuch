import { Form, useLocation } from "react-router";
import { cn } from "~/lib/utils";

const OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
] as const;

/** A plain form: works before the page is hydrated and without JavaScript. */
export function ThemeSwitch({ current }: { current: string }) {
  const { pathname, search } = useLocation();
  return (
    <Form method="post" action="/theme" className="flex items-center gap-1" aria-label="Darstellung">
      <input type="hidden" name="back" value={pathname + search} />
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="submit"
          name="theme"
          value={o.value}
          aria-pressed={current === o.value}
          className={cn(
            "border-2 border-foreground px-1.5 py-0.5 text-xs",
            current === o.value ? "bg-foreground text-background" : "bg-transparent text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </Form>
  );
}
