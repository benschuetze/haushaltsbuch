import type { ReactNode } from "react";

export function Stat({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0 rounded border-2 border-foreground bg-card p-3">
      <dt className="pixel text-muted-foreground">{label}</dt>
      {/* Scales with the screen: "−1.608,30 €" in a half-width tile on a 360 px phone would run over the edge. */}
      <dd className="mt-1 font-mono text-[clamp(0.9rem,4.2vw,1.25rem)] font-bold" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}
