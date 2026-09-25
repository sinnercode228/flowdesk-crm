'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import {
  CONTACT_STATUSES,
  type Contact,
  type ContactSortField,
  type ContactStatus,
  type SortOrder,
} from '@flowdesk/shared';
import { useContacts, useDeleteContact } from '@/hooks/queries';
import { useAuth } from '@/hooks/use-auth';
import { useDebounced } from '@/hooks/use-debounced';
import { errorMessage } from '@/lib/api';
import { PageHeader } from '../layout/app-shell';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/field';
import { Card, EmptyState, ErrorNote, Skeleton, Spinner } from '../ui/misc';
import { ContactDialog } from './contact-dialog';
import { ContactsTable } from './contacts-table';
import { Pagination } from './pagination';

export function ContactsView() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContactStatus | ''>('');
  const [sort, setSort] = useState<ContactSortField>('createdAt');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dialog, setDialog] = useState<{ contact: Contact | null } | null>(null);
  const debouncedSearch = useDebounced(search.trim());
  const remove = useDeleteContact();

  const { data, isPending, isFetching, error } = useContacts({
    search: debouncedSearch || undefined,
    status: status || undefined,
    sort,
    order,
    page,
    pageSize,
  });

  const onSort = (field: ContactSortField) => {
    if (field === sort) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(field);
      setOrder(field === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={data ? `${data.total} people across your accounts` : 'Loading contacts…'}
        actions={
          can('contact:create') && (
            <Button onClick={() => setDialog({ contact: null })}>
              <Plus className="size-4" /> New contact
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input
              type="search"
              aria-label="Search contacts"
              placeholder="Search name, e-mail, company"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            aria-label="Filter by status"
            className="w-full sm:w-40"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ContactStatus | '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          {isFetching && !isPending && <Spinner className="size-4" />}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Rows
            <Select
              className="h-8 w-20"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {(error ?? remove.error) && (
          <div className="p-3">
            <ErrorNote>{errorMessage(error ?? remove.error)}</ErrorNote>
          </div>
        )}

        <div className="overflow-x-auto">
          {isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : data && data.items.length > 0 ? (
            <ContactsTable
              contacts={data.items}
              sort={sort}
              order={order}
              onSort={onSort}
              onEdit={can('contact:update') ? (contact) => setDialog({ contact }) : undefined}
              onDelete={
                can('contact:delete')
                  ? (c) => {
                      if (
                        window.confirm(`Delete ${c.firstName} ${c.lastName}? Their deals are kept.`)
                      )
                        remove.mutate(c.id);
                    }
                  : undefined
              }
            />
          ) : (
            <EmptyState title="No contacts found">
              Try a different search or status filter.
            </EmptyState>
          )}
        </div>

        {data && data.total > 0 && (
          <div className="border-t border-line p-3">
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              pageSize={data.pageSize}
              onPage={setPage}
            />
          </div>
        )}
      </Card>

      <ContactDialog
        open={dialog !== null}
        contact={dialog?.contact ?? null}
        onClose={() => setDialog(null)}
      />
    </>
  );
}
