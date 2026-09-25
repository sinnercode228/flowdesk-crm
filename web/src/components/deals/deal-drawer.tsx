'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRightLeft, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Activity, DealDetail, Stage, User } from '@flowdesk/shared';
import { useAddNote, useDeal, useDeleteDeal, useMoveDeal, useUpdateDeal } from '@/hooks/queries';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatRelative } from '@/lib/format';
import { Button } from '../ui/button';
import { Select, Textarea } from '../ui/field';
import { Avatar, ErrorNote, Skeleton, Spinner } from '../ui/misc';
import { Drawer } from '../ui/overlay';
import { DealForm, toDateInput } from './deal-form';

const activityIcon: Record<Activity['type'], typeof Plus> = {
  created: Plus,
  stage_changed: ArrowRightLeft,
  updated: Pencil,
  note: MessageSquare,
};

function Timeline({ activities }: { activities: Activity[] }) {
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {activities.map((a) => {
        const Icon = activityIcon[a.type];
        return (
          <li key={a.id} className="relative">
            <span className="absolute top-0.5 -left-[29px] grid size-4.5 place-items-center rounded-full border border-line bg-surface text-muted">
              <Icon className="size-2.5" />
            </span>
            <p
              className={
                a.type === 'note'
                  ? 'rounded-lg bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap'
                  : 'text-sm'
              }
            >
              {a.type === 'stage_changed' && a.meta?.from && a.meta.to ? (
                <>
                  Moved from <b>{a.meta.from}</b> to <b>{a.meta.to}</b>
                </>
              ) : (
                a.message
              )}
            </p>
            <p className="mt-1 text-xs text-muted" title={new Date(a.createdAt).toLocaleString()}>
              {a.author?.name ?? 'System'} · {formatRelative(a.createdAt)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function DrawerBody({
  deal,
  stages,
  users,
  onClose,
}: {
  deal: DealDetail;
  stages: Stage[];
  users: User[];
  onClose: () => void;
}) {
  const { can } = useAuth();
  const ownerRef = { ownerId: deal.owner.id };
  const canEdit = can('deal:update', ownerRef);
  const canMove = can('deal:move', ownerRef);
  const update = useUpdateDeal(deal.id);
  const move = useMoveDeal();
  const addNote = useAddNote(deal.id);
  const remove = useDeleteDeal();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const stage = stages.find((s) => s.id === deal.stageId);

  const submitNote = (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    addNote.mutate(note.trim(), { onSuccess: () => setNote('') });
  };

  const error = update.error ?? move.error ?? addNote.error ?? remove.error;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs text-muted">Value</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{formatMoney(deal.value)}</p>
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          <label htmlFor="drawer-stage" className="text-xs text-muted">
            Stage {stage ? `· ${stage.probability}%` : ''}
          </label>
          <Select
            id="drawer-stage"
            className="mt-1 h-8"
            value={deal.stageId}
            disabled={!canMove || move.isPending}
            onChange={(e) => move.mutate({ id: deal.id, stageId: e.target.value, position: 0 })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <DealForm
            id="edit-deal"
            stages={stages}
            users={users}
            showStage={false}
            canAssign={can('deal:assign')}
            disabled={update.isPending}
            initial={{
              title: deal.title,
              value: String(deal.value),
              priority: deal.priority,
              stageId: deal.stageId,
              contactId: deal.contact?.id ?? '',
              ownerId: deal.owner.id,
              expectedCloseDate: toDateInput(deal.expectedCloseDate),
            }}
            onSubmit={(v) => {
              const input = {
                title: v.title,
                value: Math.round(Number(v.value) || 0),
                priority: v.priority,
                contactId: v.contactId || null,
                expectedCloseDate: v.expectedCloseDate || null,
                ...(v.ownerId !== deal.owner.id ? { ownerId: v.ownerId } : {}),
              };
              update.mutate(input, { onSuccess: () => setEditing(false) });
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" form="edit-deal" size="sm" loading={update.isPending}>
              Save changes
            </Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-muted">Contact</dt>
          <dd>
            {deal.contact ? (
              <>
                {deal.contact.name}
                <span className="block text-xs text-muted">
                  {[deal.contact.company, deal.contact.email].filter(Boolean).join(' · ')}
                </span>
              </>
            ) : (
              '—'
            )}
          </dd>
          <dt className="text-muted">Owner</dt>
          <dd className="flex items-center gap-2">
            <Avatar name={deal.owner.name} color={deal.owner.avatarColor} size="sm" />
            {deal.owner.name}
          </dd>
          <dt className="text-muted">Priority</dt>
          <dd className="capitalize">{deal.priority}</dd>
          <dt className="text-muted">Expected close</dt>
          <dd>{formatDate(deal.expectedCloseDate)}</dd>
          {deal.closedAt && (
            <>
              <dt className="text-muted">Closed</dt>
              <dd>{formatDate(deal.closedAt)}</dd>
            </>
          )}
          <dt className="text-muted">Created</dt>
          <dd>{formatDate(deal.createdAt)}</dd>
        </dl>
      )}

      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}

      <div className="flex flex-wrap gap-2">
        {!editing && canEdit && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit deal
          </Button>
        )}
        {can('deal:delete') && (
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-600 hover:text-rose-600 dark:text-rose-400"
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete "${deal.title}"? This cannot be undone.`)) {
                remove.mutate(deal.id, { onSuccess: onClose });
              }
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        )}
        {!canEdit && (
          <p className="text-xs text-muted">
            You can view this deal and add notes; editing is limited to its owner and admins.
          </p>
        )}
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Activity</h3>
        {can('deal:comment', ownerRef) && (
          <form onSubmit={submitNote} className="space-y-2">
            <label htmlFor="note" className="sr-only">
              Add a note
            </label>
            <Textarea
              id="note"
              placeholder="Add a note: call summary, next steps…"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={addNote.isPending} disabled={!note.trim()}>
                Add note
              </Button>
            </div>
          </form>
        )}
        <Timeline activities={deal.activities} />
      </section>
    </div>
  );
}

export function DealDrawer({
  dealId,
  onClose,
  stages,
  users,
}: {
  dealId: string | null;
  onClose: () => void;
  stages: Stage[];
  users: User[];
}) {
  const { data, isPending, error, isFetching } = useDeal(dealId);
  return (
    <Drawer
      open={Boolean(dealId)}
      onClose={onClose}
      title={
        <div>
          <p className="text-xs text-muted">
            Deal {isFetching && !isPending && <Spinner className="ml-1 size-3 align-middle" />}
          </p>
          <h2 className="truncate text-base font-semibold">{data?.title ?? 'Loading…'}</h2>
        </div>
      }
    >
      {error ? (
        <ErrorNote>{errorMessage(error)}</ErrorNote>
      ) : isPending || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <DrawerBody key={data.id} deal={data} stages={stages} users={users} onClose={onClose} />
      )}
    </Drawer>
  );
}
