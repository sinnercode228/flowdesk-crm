'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useAnalytics } from '@/hooks/queries';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PageHeader } from '../layout/app-shell';
import { Card, ErrorNote, Skeleton } from '../ui/misc';
import { Funnel } from './funnel';
import { KpiCards } from './kpi-cards';
import { Leaderboard } from './leaderboard';
import { RevenueChart } from './revenue-chart';

export function DashboardView() {
  const { user } = useAuth();
  const { data, isPending, error } = useAnalytics();
  const firstName = user?.name.split(' ')[0];

  return (
    <>
      <PageHeader
        title={`Welcome back${firstName ? `, ${firstName}` : ''}`}
        subtitle="Pipeline health and revenue at a glance."
        actions={
          <Link
            href="/deals"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink shadow-sm hover:opacity-90"
          >
            Open pipeline <ArrowRight className="size-4" />
          </Link>
        }
      />
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      {isPending ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : data ? (
        <div className="space-y-4">
          <KpiCards summary={data.summary} />
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-4 xl:col-span-2">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Won revenue by month</h2>
                  <p className="text-xs text-muted">Last 12 months, by close date (UTC)</p>
                </div>
                <p className="text-sm text-muted">
                  Total{' '}
                  <span className="font-semibold text-ink tabular-nums">
                    {formatMoney(data.revenue.reduce((s, p) => s + p.wonValue, 0))}
                  </span>
                </p>
              </div>
              <RevenueChart data={data.revenue} />
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Conversion funnel</h2>
              <p className="mb-4 text-xs text-muted">Deals that reached each stage or beyond</p>
              <Funnel steps={data.funnel} />
            </Card>
          </div>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Team performance</h2>
            <Leaderboard rows={data.leaderboard} />
          </Card>
        </div>
      ) : null}
    </>
  );
}
