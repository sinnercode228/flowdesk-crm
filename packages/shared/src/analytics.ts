/**
 * Pure analytics functions. The REST server and the in-browser demo API both use them,
 * so the numbers are identical whichever backend is active.
 */
import type {
  AnalyticsSummary,
  FunnelStep,
  OwnerPerformance,
  RevenuePoint,
} from './schemas/analytics';
import type { StageKind } from './schemas/stage';

export interface AnalyticsDeal {
  value: number;
  stageId: string;
  ownerId: string;
  createdAt: Date | string;
  closedAt: Date | string | null;
}

export interface AnalyticsStage {
  id: string;
  name: string;
  position: number;
  probability: number;
  kind: StageKind;
  color: string;
}

export interface AnalyticsUser {
  id: string;
  name: string;
  avatarColor: string;
}

const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));

/** `YYYY-MM` in UTC. */
export function monthKey(d: Date | string): string {
  const date = toDate(d);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The last `count` month keys ending with the month of `now`, oldest first. */
export function lastMonthKeys(count: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return keys;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

function indexStages(stages: AnalyticsStage[]) {
  return new Map(stages.map((s) => [s.id, s]));
}

export function computeSummary(
  deals: AnalyticsDeal[],
  stages: AnalyticsStage[],
  now: Date = new Date(),
): AnalyticsSummary {
  const byId = indexStages(stages);
  const thisMonth = monthKey(now);
  const prevMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

  let openCount = 0;
  let openPipelineValue = 0;
  let weighted = 0;
  let wonCount = 0;
  let wonValue = 0;
  let lostCount = 0;
  let wonValueThisMonth = 0;
  let wonValuePrevMonth = 0;

  for (const deal of deals) {
    const stage = byId.get(deal.stageId);
    if (!stage) continue;
    if (stage.kind === 'open') {
      openCount++;
      openPipelineValue += deal.value;
      weighted += (deal.value * stage.probability) / 100;
    } else if (stage.kind === 'won') {
      wonCount++;
      wonValue += deal.value;
      if (deal.closedAt) {
        const key = monthKey(deal.closedAt);
        if (key === thisMonth) wonValueThisMonth += deal.value;
        if (key === prevMonth) wonValuePrevMonth += deal.value;
      }
    } else {
      lostCount++;
    }
  }

  return {
    openCount,
    openPipelineValue,
    weightedPipelineValue: Math.round(weighted),
    wonCount,
    wonValue,
    lostCount,
    winRate: ratio(wonCount, wonCount + lostCount),
    avgWonDealSize: Math.round(ratio(wonValue, wonCount)),
    wonValueThisMonth,
    wonValuePrevMonth,
  };
}

export function computeRevenueByMonth(
  deals: AnalyticsDeal[],
  stages: AnalyticsStage[],
  months = 12,
  now: Date = new Date(),
): RevenuePoint[] {
  const byId = indexStages(stages);
  const points = new Map<string, RevenuePoint>(
    lastMonthKeys(months, now).map((month) => [
      month,
      { month, wonValue: 0, wonCount: 0, createdValue: 0 },
    ]),
  );

  for (const deal of deals) {
    const created = points.get(monthKey(deal.createdAt));
    if (created) created.createdValue += deal.value;

    const stage = byId.get(deal.stageId);
    if (stage?.kind === 'won' && deal.closedAt) {
      const won = points.get(monthKey(deal.closedAt));
      if (won) {
        won.wonValue += deal.value;
        won.wonCount++;
      }
    }
  }
  return [...points.values()];
}

/**
 * Snapshot funnel: every non-lost stage in pipeline order (won last). A deal counts
 * towards a step when its current stage is that step or any later one.
 */
export function computeFunnel(deals: AnalyticsDeal[], stages: AnalyticsStage[]): FunnelStep[] {
  const steps = stages
    .filter((s) => s.kind !== 'lost')
    .sort((a, b) => Number(a.kind === 'won') - Number(b.kind === 'won') || a.position - b.position);
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]));

  const counts = steps.map(() => ({ count: 0, value: 0 }));
  for (const deal of deals) {
    const idx = stepIndex.get(deal.stageId);
    if (idx === undefined) continue;
    for (let i = 0; i <= idx; i++) {
      counts[i]!.count++;
      counts[i]!.value += deal.value;
    }
  }

  const start = counts[0]?.count ?? 0;
  return steps.map((stage, i) => ({
    stageId: stage.id,
    name: stage.name,
    color: stage.color,
    count: counts[i]!.count,
    value: counts[i]!.value,
    conversionFromPrev: i === 0 ? null : ratio(counts[i]!.count, counts[i - 1]!.count),
    conversionFromStart: ratio(counts[i]!.count, start),
  }));
}

export function computeLeaderboard(
  deals: AnalyticsDeal[],
  stages: AnalyticsStage[],
  users: AnalyticsUser[],
): OwnerPerformance[] {
  const byId = indexStages(stages);
  const rows = new Map<string, OwnerPerformance & { lostCount: number }>(
    users.map((u) => [
      u.id,
      {
        ownerId: u.id,
        name: u.name,
        avatarColor: u.avatarColor,
        wonValue: 0,
        wonCount: 0,
        openValue: 0,
        openCount: 0,
        winRate: 0,
        lostCount: 0,
      },
    ]),
  );

  for (const deal of deals) {
    const row = rows.get(deal.ownerId);
    const stage = byId.get(deal.stageId);
    if (!row || !stage) continue;
    if (stage.kind === 'won') {
      row.wonValue += deal.value;
      row.wonCount++;
    } else if (stage.kind === 'lost') {
      row.lostCount++;
    } else {
      row.openValue += deal.value;
      row.openCount++;
    }
  }

  return [...rows.values()]
    .map(({ lostCount, ...row }) => ({
      ...row,
      winRate: ratio(row.wonCount, row.wonCount + lostCount),
    }))
    .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue);
}
