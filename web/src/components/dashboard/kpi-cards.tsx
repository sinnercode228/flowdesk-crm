import type { AnalyticsSummary } from '@flowdesk/shared';
import { clsx } from 'clsx';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatMoney, formatMoneyCompact, formatPercent, percentChange } from '@/lib/format';
import { Card } from '../ui/misc';

export function KpiCards({ summary }: { summary: AnalyticsSummary }) {
  const change = percentChange(summary.wonValueThisMonth, summary.wonValuePrevMonth);
  const tiles = [
    {
      label: 'Open pipeline',
      value: formatMoneyCompact(summary.openPipelineValue),
      hint: `${summary.openCount} open deals`,
      title: formatMoney(summary.openPipelineValue),
    },
    {
      label: 'Weighted forecast',
      value: formatMoneyCompact(summary.weightedPipelineValue),
      hint: 'Value × stage probability',
      title: formatMoney(summary.weightedPipelineValue),
    },
    {
      label: 'Won this month',
      value: formatMoneyCompact(summary.wonValueThisMonth),
      hint: `vs ${formatMoneyCompact(summary.wonValuePrevMonth)} last month`,
      change,
      title: formatMoney(summary.wonValueThisMonth),
    },
    {
      label: 'Win rate',
      value: formatPercent(summary.winRate),
      hint: `${summary.wonCount} won · ${summary.lostCount} lost · avg ${formatMoneyCompact(summary.avgWonDealSize)}`,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label} className="p-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">{t.label}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-2xl font-semibold tabular-nums" title={t.title}>
              {t.value}
            </p>
            {t.change !== undefined && t.change !== null && (
              <span
                className={clsx(
                  'inline-flex items-center gap-0.5 text-xs font-medium',
                  t.change >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {t.change >= 0 ? (
                  <TrendingUp className="size-3.5" />
                ) : (
                  <TrendingDown className="size-3.5" />
                )}
                {t.change >= 0 ? '+' : ''}
                {formatPercent(t.change)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{t.hint}</p>
        </Card>
      ))}
    </div>
  );
}
