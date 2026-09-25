import type { FunnelStep } from '@flowdesk/shared';
import { formatMoneyCompact, formatPercent } from '@/lib/format';

/** Horizontal funnel: bar length = share of deals that reached the stage. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <ol className="space-y-3" aria-label="Pipeline funnel">
      {steps.map((step) => (
        <li key={step.stageId} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <span
                className="size-2.5 rounded-sm"
                style={{ backgroundColor: step.color }}
                aria-hidden
              />
              {step.name}
            </span>
            <span className="text-xs text-muted tabular-nums">
              {step.count} deals · {formatMoneyCompact(step.value)}
              {step.conversionFromPrev !== null && (
                <span className="ml-2 font-medium text-ink">
                  {formatPercent(step.conversionFromPrev)} from prev.
                </span>
              )}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{
                width: `${(step.count / max) * 100}%`,
                opacity: 0.45 + 0.55 * step.conversionFromStart,
              }}
              title={`${formatPercent(step.conversionFromStart)} of all deals reached ${step.name}`}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
