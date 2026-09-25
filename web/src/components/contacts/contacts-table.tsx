import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Trash2 } from 'lucide-react';
import type { Contact, ContactSortField, SortOrder } from '@flowdesk/shared';
import { formatDate } from '@/lib/format';
import { Avatar, StatusBadge } from '../ui/misc';

const COLUMNS: Array<{ key: ContactSortField | null; label: string; className?: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company', className: 'hidden md:table-cell' },
  { key: 'email', label: 'E-mail', className: 'hidden lg:table-cell' },
  { key: 'status', label: 'Status' },
  { key: null, label: 'Deals', className: 'hidden sm:table-cell text-right' },
  { key: 'createdAt', label: 'Added', className: 'hidden xl:table-cell' },
];

export interface ContactsTableProps {
  contacts: Contact[];
  sort: ContactSortField;
  order: SortOrder;
  onSort: (field: ContactSortField) => void;
  onEdit?: (contact: Contact) => void;
  onDelete?: (contact: Contact) => void;
}

export function ContactsTable({
  contacts,
  sort,
  order,
  onSort,
  onEdit,
  onDelete,
}: ContactsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
        <tr>
          {COLUMNS.map((col) => {
            const active = col.key === sort;
            const Icon = !active ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
            return (
              <th
                key={col.label}
                scope="col"
                className={clsx('px-3 py-2.5 font-medium sm:px-4', col.className)}
                aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {col.key ? (
                  <button
                    type="button"
                    onClick={() => onSort(col.key!)}
                    className={clsx(
                      'inline-flex items-center gap-1 hover:text-ink',
                      active && 'text-ink',
                    )}
                  >
                    {col.label}
                    <Icon className={clsx('size-3', !active && 'opacity-40')} />
                  </button>
                ) : (
                  col.label
                )}
              </th>
            );
          })}
          <th scope="col" className="px-3 py-2.5 sm:px-4">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {contacts.map((c) => (
          <tr key={c.id} className="transition hover:bg-surface-2/50">
            <td className="px-3 py-3 sm:px-4">
              <div className="flex items-center gap-3">
                <Avatar
                  name={`${c.firstName} ${c.lastName}`}
                  color={c.owner?.avatarColor ?? '#94a3b8'}
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {c.firstName} {c.lastName}
                  </p>
                  <p className="truncate text-xs text-muted">{c.title ?? c.company ?? c.email}</p>
                </div>
              </div>
            </td>
            <td className="hidden px-4 py-3 md:table-cell">{c.company ?? '—'}</td>
            <td className="hidden px-4 py-3 text-muted lg:table-cell">{c.email}</td>
            <td className="px-3 py-3 sm:px-4">
              <StatusBadge status={c.status} />
            </td>
            <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
              {c.dealsCount}
            </td>
            <td className="hidden px-4 py-3 text-muted xl:table-cell">{formatDate(c.createdAt)}</td>
            <td className="px-3 py-3 sm:px-4">
              <div className="flex justify-end gap-1">
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(c)}
                    aria-label={`Edit ${c.firstName} ${c.lastName}`}
                    className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                  >
                    <Pencil className="size-4" />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(c)}
                    aria-label={`Delete ${c.firstName} ${c.lastName}`}
                    className="rounded-md p-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
