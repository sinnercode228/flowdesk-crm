/** Minimal shape needed to reorder cards; both `Deal` DTOs and demo rows satisfy it. */
export interface Positioned {
  id: string;
  stageId: string;
  position: number;
  createdAt: string;
}

export const byColumnOrder = (a: Positioned, b: Positioned) =>
  a.position - b.position || b.createdAt.localeCompare(a.createdAt);

/**
 * Moves `id` to `position` inside `stageId` and re-indexes the source and target columns to
 * 0..n-1, exactly like `POST /deals/:id/move` does on the server. Returns new objects for the
 * rows that changed; untouched rows keep their identity (cheap React re-renders).
 */
export function applyMove<T extends Positioned>(
  items: T[],
  id: string,
  stageId: string,
  position: number,
): T[] {
  const moving = items.find((d) => d.id === id);
  if (!moving) return items;

  const target = items.filter((d) => d.stageId === stageId && d.id !== id).sort(byColumnOrder);
  const index = Math.max(0, Math.min(position, target.length));
  target.splice(index, 0, moving);

  const next = new Map<string, { stageId: string; position: number }>();
  target.forEach((d, i) => next.set(d.id, { stageId, position: i }));
  if (moving.stageId !== stageId) {
    items
      .filter((d) => d.stageId === moving.stageId && d.id !== id)
      .sort(byColumnOrder)
      .forEach((d, i) => next.set(d.id, { stageId: d.stageId, position: i }));
  }

  return items.map((d) => {
    const n = next.get(d.id);
    return n && (n.stageId !== d.stageId || n.position !== d.position) ? { ...d, ...n } : d;
  });
}

/** Groups items by stage, each column sorted by position. */
export function groupByStage<T extends Positioned>(
  items: T[],
  stageIds: string[],
): Record<string, T[]> {
  const columns: Record<string, T[]> = Object.fromEntries(stageIds.map((id) => [id, [] as T[]]));
  for (const item of items) columns[item.stageId]?.push(item);
  for (const id of stageIds) columns[id]!.sort(byColumnOrder);
  return columns;
}
