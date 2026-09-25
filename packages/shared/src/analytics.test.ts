import { describe, expect, it } from 'vitest';
import {
  computeFunnel,
  computeLeaderboard,
  computeRevenueByMonth,
  computeSummary,
  lastMonthKeys,
  monthKey,
  type AnalyticsDeal,
  type AnalyticsStage,
} from './analytics';

const stages: AnalyticsStage[] = [
  { id: 'lead', name: 'Lead', position: 0, probability: 10, kind: 'open', color: '#000000' },
  {
    id: 'proposal',
    name: 'Proposal',
    position: 1,
    probability: 50,
    kind: 'open',
    color: '#000000',
  },
  { id: 'lost', name: 'Lost', position: 2, probability: 0, kind: 'lost', color: '#000000' },
  { id: 'won', name: 'Won', position: 3, probability: 100, kind: 'won', color: '#000000' },
];

const now = new Date('2026-06-15T12:00:00Z');

const deals: AnalyticsDeal[] = [
  {
    value: 1000,
    stageId: 'lead',
    ownerId: 'u1',
    createdAt: '2026-06-01T00:00:00Z',
    closedAt: null,
  },
  {
    value: 3000,
    stageId: 'proposal',
    ownerId: 'u1',
    createdAt: '2026-05-10T00:00:00Z',
    closedAt: null,
  },
  {
    value: 5000,
    stageId: 'won',
    ownerId: 'u2',
    createdAt: '2026-04-01T00:00:00Z',
    closedAt: '2026-06-02T00:00:00Z',
  },
  {
    value: 7000,
    stageId: 'won',
    ownerId: 'u1',
    createdAt: '2026-03-01T00:00:00Z',
    closedAt: '2026-05-20T00:00:00Z',
  },
  {
    value: 2000,
    stageId: 'lost',
    ownerId: 'u2',
    createdAt: '2026-02-01T00:00:00Z',
    closedAt: '2026-03-01T00:00:00Z',
  },
];

describe('month helpers', () => {
  it('formats month keys in UTC', () => {
    expect(monthKey('2026-01-31T23:30:00Z')).toBe('2026-01');
  });

  it('returns the trailing months oldest first, crossing year boundaries', () => {
    expect(lastMonthKeys(3, new Date('2026-02-10T00:00:00Z'))).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('computeSummary', () => {
  it('aggregates pipeline, won/lost and win rate', () => {
    const summary = computeSummary(deals, stages, now);
    expect(summary).toEqual({
      openCount: 2,
      openPipelineValue: 4000,
      weightedPipelineValue: 1000 * 0.1 + 3000 * 0.5,
      wonCount: 2,
      wonValue: 12000,
      lostCount: 1,
      winRate: 2 / 3,
      avgWonDealSize: 6000,
      wonValueThisMonth: 5000,
      wonValuePrevMonth: 7000,
    });
  });

  it('handles an empty pipeline without dividing by zero', () => {
    const summary = computeSummary([], stages, now);
    expect(summary.winRate).toBe(0);
    expect(summary.avgWonDealSize).toBe(0);
  });
});

describe('computeRevenueByMonth', () => {
  it('buckets won revenue by close month and new pipeline by creation month', () => {
    const points = computeRevenueByMonth(deals, stages, 3, now);
    expect(points).toEqual([
      { month: '2026-04', wonValue: 0, wonCount: 0, createdValue: 5000 },
      { month: '2026-05', wonValue: 7000, wonCount: 1, createdValue: 3000 },
      { month: '2026-06', wonValue: 5000, wonCount: 1, createdValue: 1000 },
    ]);
  });
});

describe('computeFunnel', () => {
  it('counts deals that reached each stage and ignores lost deals', () => {
    const funnel = computeFunnel(deals, stages);
    expect(funnel.map((s) => [s.stageId, s.count])).toEqual([
      ['lead', 4],
      ['proposal', 3],
      ['won', 2],
    ]);
    expect(funnel[0]!.conversionFromPrev).toBeNull();
    expect(funnel[1]!.conversionFromPrev).toBeCloseTo(0.75);
    expect(funnel[2]!.conversionFromStart).toBeCloseTo(0.5);
  });
});

describe('computeLeaderboard', () => {
  it('ranks owners by won revenue', () => {
    const board = computeLeaderboard(deals, stages, [
      { id: 'u1', name: 'One', avatarColor: '#111111' },
      { id: 'u2', name: 'Two', avatarColor: '#222222' },
    ]);
    expect(board.map((r) => r.ownerId)).toEqual(['u1', 'u2']);
    expect(board[0]).toMatchObject({ wonValue: 7000, openValue: 4000, openCount: 2, winRate: 1 });
    expect(board[1]).toMatchObject({ wonValue: 5000, winRate: 0.5 });
  });
});
