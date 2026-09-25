import { forwardRef, type HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { CalendarDays, Lock } from 'lucide-react';
import type { Deal } from '@flowdesk/shared';
import { formatDate, formatMoney } from '@/lib/format';
import { Avatar, PriorityBadge } from '../ui/misc';

interface DealCardProps extends HTMLAttributes<HTMLDivElement> {
  deal: Deal;
  locked?: boolean;
  dragging?: boolean;
  overlay?: boolean;
}

export const DealCard = forwardRef<HTMLDivElement, DealCardProps>(function DealCard(
  { deal, locked, dragging, overlay, className, ...props },
  ref,
) {
  const overdue =
    deal.expectedCloseDate && !deal.closedAt && new Date(deal.expectedCloseDate) < new Date();
  return (
    <div
      ref={ref}
      data-testid="deal-card"
      className={clsx(
        'group rounded-lg border border-line bg-surface p-3 text-left shadow-sm transition select-none',
        locked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        'hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none',
        dragging && 'opacity-40',
        overlay && 'rotate-2 cursor-grabbing shadow-xl ring-2 ring-accent/40',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm leading-snug font-medium">{deal.title}</p>
        {locked && (
          <Lock
            className="mt-0.5 size-3.5 shrink-0 text-muted"
            aria-label="Owned by another user"
          />
        )}
      </div>
      {deal.contact && (
        <p className="mt-1 truncate text-xs text-muted">
          {deal.contact.name}
          {deal.contact.company ? ` · ${deal.contact.company}` : ''}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">{formatMoney(deal.value)}</span>
        <PriorityBadge priority={deal.priority} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span
          className={clsx(
            'inline-flex items-center gap-1',
            overdue && 'text-rose-600 dark:text-rose-400',
          )}
        >
          <CalendarDays className="size-3.5" />
          {deal.closedAt
            ? `Closed ${formatDate(deal.closedAt)}`
            : formatDate(deal.expectedCloseDate)}
        </span>
        <Avatar name={deal.owner.name} color={deal.owner.avatarColor} size="sm" />
      </div>
    </div>
  );
});
