import type { ReactNode } from "react";

export function Stat({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="rounded border-2 border-foreground bg-card p-3">
      <dt className="pixel text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-bold" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}
