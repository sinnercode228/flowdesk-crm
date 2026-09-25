'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RevenuePoint } from '@flowdesk/shared';
import { formatMoney, formatMoneyCompact, formatMonth } from '@/lib/format';

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: RevenuePoint }>;
}

function RevenueTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{formatMonth(point.month)}</p>
      <p className="mt-1 text-ink tabular-nums">Won: {formatMoney(point.wonValue)}</p>
      <p className="text-muted tabular-nums">
        {point.wonCount} deal{point.wonCount === 1 ? '' : 's'} closed ·{' '}
        {formatMoneyCompact(point.createdValue)} new pipeline
      </p>
    </div>
  );
}

/** Won revenue per month: one measure, one axis, hover tooltip with the details. */
export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Won revenue by month, last 12 months">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="28%"
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickFormatter={formatMonth}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            tickFormatter={(v: number) => formatMoneyCompact(v)}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar
            dataKey="wonValue"
            name="Won revenue"
            fill="var(--accent)"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
