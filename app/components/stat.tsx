import type { ReactNode } from "react";

export function Stat({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}
