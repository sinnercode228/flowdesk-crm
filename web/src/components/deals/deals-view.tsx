'use client';

import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useDeals, useMoveDeal, useStages, useUsers } from '@/hooks/queries';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { formatMoneyCompact } from '@/lib/format';
import { PageHeader } from '../layout/app-shell';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/field';
import { ErrorNote, Skeleton } from '../ui/misc';
import { DealDrawer } from './deal-drawer';
import { KanbanBoard } from './kanban-board';
import { NewDealDialog } from './new-deal-dialog';

export function DealsView() {
  const { can, user } = useAuth();
  const stages = useStages();
  const deals = useDeals();
  const users = useUsers();
  const move = useMoveDeal();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (deals.data ?? []).filter(
      (d) =>
        (!owner || d.owner.id === owner) &&
        (!q ||
          d.title.toLowerCase().includes(q) ||
          d.contact?.name.toLowerCase().includes(q) ||
          d.contact?.company?.toLowerCase().includes(q)),
    );
  }, [deals.data, search, owner]);

  const filtering = Boolean(search.trim() || owner);
  const openStageIds = new Set(stages.data?.filter((s) => s.kind === 'open').map((s) => s.id));
  const openValue = filtered
    .filter((d) => openStageIds.has(d.stageId))
    .reduce((s, d) => s + d.value, 0);
  const error = stages.error ?? deals.error ?? move.error;

  return (
    <>
      <PageHeader
        title="Deals pipeline"
        subtitle={
          deals.data
            ? `${filtered.length} deals · ${formatMoneyCompact(openValue)} open. Drag cards between stages.`
            : 'Loading pipeline…'
        }
        actions={
          can('deal:create') && (
            <Button onClick={() => setCreating(true)} disabled={!stages.data}>
              <Plus className="size-4" /> New deal
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            aria-label="Search deals"
            placeholder="Search deals, contacts, companies"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Filter by owner"
          className="w-full sm:w-48"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">All owners</option>
          {user && <option value={user.id}>My deals</option>}
          {users.data
            ?.filter((u) => u.id !== user?.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </Select>
        {filtering && <p className="text-xs text-muted">Clear filters to reorder cards.</p>}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(error)}</ErrorNote>
        </div>
      )}

      {stages.data && deals.data ? (
        <KanbanBoard
          stages={stages.data}
          deals={filtered}
          dragDisabled={filtering}
          canMove={(d) => can('deal:move', { ownerId: d.owner.id })}
          onMove={(id, stageId, position) => move.mutate({ id, stageId, position })}
          onOpen={setOpenId}
        />
      ) : (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-96 w-72 shrink-0 lg:flex-1" />
          ))}
        </div>
      )}

      <DealDrawer
        dealId={openId}
        onClose={() => setOpenId(null)}
        stages={stages.data ?? []}
        users={users.data ?? []}
      />
      <NewDealDialog
        open={creating}
        onClose={() => setCreating(false)}
        stages={stages.data ?? []}
        users={users.data ?? []}
        onCreated={setOpenId}
      />
    </>
  );
}
