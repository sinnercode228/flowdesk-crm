'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import type { Deal, Stage } from '@flowdesk/shared';
import { formatMoneyCompact } from '@/lib/format';
import { groupByStage } from '@/lib/kanban';
import { DealCard } from './deal-card';

type Columns = Record<string, string[]>;

export interface KanbanBoardProps {
  stages: Stage[];
  deals: Deal[];
  canMove: (deal: Deal) => boolean;
  onMove: (dealId: string, stageId: string, position: number) => void;
  onOpen: (dealId: string) => void;
  /** Disables drag and drop (e.g. while a filter hides part of a column). */
  dragDisabled?: boolean;
}

function SortableDeal({
  deal,
  locked,
  onOpen,
}: {
  deal: Deal;
  locked: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    disabled: locked,
  });
  return (
    <DealCard
      ref={setNodeRef}
      deal={deal}
      locked={locked}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable deal"
      aria-label={`${deal.title}, press Enter to open`}
      onClick={() => onOpen(deal.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(deal.id);
        else listeners?.onKeyDown?.(e);
      }}
    />
  );
}

function Column({ stage, deals, children }: { stage: Stage; deals: Deal[]; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = deals.reduce((s, d) => s + d.value, 0);
  return (
    <section
      aria-label={`${stage.name} column`}
      className="flex w-72 shrink-0 snap-start flex-col rounded-xl border border-line bg-surface-2/60 lg:w-auto lg:min-w-[15.5rem] lg:flex-1"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: stage.color }}
            aria-hidden
          />
          <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
          <span className="rounded-full bg-surface px-1.5 text-xs text-muted tabular-nums">
            {deals.length}
          </span>
        </div>
        <span
          className="text-xs text-muted tabular-nums"
          title={`${stage.probability}% win probability`}
        >
          {formatMoneyCompact(total)}
        </span>
      </header>
      <div
        ref={setNodeRef}
        className={clsx(
          'scrollbar-thin flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors lg:max-h-[calc(100dvh-15rem)]',
          isOver && 'bg-accent-soft/60',
        )}
      >
        {children}
        {deals.length === 0 && (
          <p className="rounded-lg border border-dashed border-line py-6 text-center text-xs text-muted">
            Drop deals here
          </p>
        )}
      </div>
    </section>
  );
}

export function KanbanBoard({
  stages,
  deals,
  canMove,
  onMove,
  onOpen,
  dragDisabled,
}: KanbanBoardProps) {
  const stageIds = useMemo(() => stages.map((s) => s.id), [stages]);
  const byId = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const base = useMemo<Columns>(() => {
    const grouped = groupByStage(deals, stageIds);
    return Object.fromEntries(stageIds.map((id) => [id, grouped[id]!.map((d) => d.id)]));
  }, [deals, stageIds]);

  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const columns = dragColumns ?? base;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (cols: Columns, id: string) =>
    id in cols ? id : stageIds.find((s) => cols[s]!.includes(id));

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDragColumns(base);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragColumns((prev) => {
      const cols = prev ?? base;
      const from = findColumn(cols, String(active.id));
      const to = findColumn(cols, String(over.id));
      if (!from || !to || from === to) return prev;
      const target = cols[to]!;
      const overIndex = target.indexOf(String(over.id));
      const below =
        over.rect && active.rect.current.translated
          ? active.rect.current.translated.top > over.rect.top + over.rect.height / 2
          : false;
      const index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
      return {
        ...cols,
        [from]: cols[from]!.filter((id) => id !== active.id),
        [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const cols = dragColumns ?? base;
    setActiveId(null);
    setDragColumns(null);
    if (!over) return;
    const to = findColumn(cols, String(over.id));
    if (!to) return;
    let list = cols[to]!;
    const oldIndex = list.indexOf(id);
    const overIndex = list.indexOf(String(over.id));
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex)
      list = arrayMove(list, oldIndex, overIndex);
    const position = list.indexOf(id);
    const deal = byId.get(id);
    if (!deal || position < 0) return;
    if (deal.stageId !== to || deal.position !== position) onMove(id, to, position);
  };

  const activeDeal = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragColumns(null);
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Press space to pick up a deal, use arrow keys to move it, space to drop, escape to cancel.',
        },
      }}
    >
      <div className="scrollbar-thin -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 lg:mx-0 lg:px-0">
        {stages.map((stage) => {
          const ids = columns[stage.id] ?? [];
          const columnDeals = ids.map((id) => byId.get(id)).filter((d): d is Deal => Boolean(d));
          return (
            <Column key={stage.id} stage={stage} deals={columnDeals}>
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {columnDeals.map((deal) => (
                  <SortableDeal
                    key={deal.id}
                    deal={deal}
                    locked={dragDisabled || !canMove(deal)}
                    onOpen={onOpen}
                  />
                ))}
              </SortableContext>
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
        {activeDeal ? <DealCard deal={activeDeal} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
