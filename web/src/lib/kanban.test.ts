import { describe, expect, it } from 'vitest';
import { applyMove, groupByStage, type Positioned } from './kanban';

const row = (id: string, stageId: string, position: number): Positioned => ({
  id,
  stageId,
  position,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const board = () => [
  row('a', 's1', 0),
  row('b', 's1', 1),
  row('c', 's1', 2),
  row('d', 's2', 0),
  row('e', 's2', 1),
];
const column = (items: Positioned[], stageId: string) =>
  groupByStage(items, ['s1', 's2'])[stageId]!.map((d) => `${d.id}${d.position}`);

describe('applyMove', () => {
  it('reorders inside a column', () => {
    const next = applyMove(board(), 'a', 's1', 2);
    expect(column(next, 's1')).toEqual(['b0', 'c1', 'a2']);
  });

  it('moves across columns and re-indexes both', () => {
    const next = applyMove(board(), 'b', 's2', 1);
    expect(column(next, 's1')).toEqual(['a0', 'c1']);
    expect(column(next, 's2')).toEqual(['d0', 'b1', 'e2']);
  });

  it('clamps out-of-range positions to the end of the column', () => {
    const next = applyMove(board(), 'a', 's2', 99);
    expect(column(next, 's2')).toEqual(['d0', 'e1', 'a2']);
  });

  it('keeps object identity for untouched rows', () => {
    const items = board();
    const next = applyMove(items, 'e', 's2', 0);
    expect(next[0]).toBe(items[0]);
    expect(next.find((d) => d.id === 'e')!.position).toBe(0);
  });

  it('ignores unknown ids', () => {
    const items = board();
    expect(applyMove(items, 'zzz', 's1', 0)).toBe(items);
  });
});
