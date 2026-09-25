import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import type { ContactStatus, Priority } from '@flowdesk/shared';
import { initials } from '@/lib/format';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx('rounded-xl border border-line bg-surface shadow-sm', className)}>
      {children}
    </div>
  );
}

export function Avatar({
  name,
  color,
  size = 'md',
}: {
  name: string;
  color: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      title={name}
      aria-label={name}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs',
      )}
      style={{ backgroundColor: color }}
    >
      {initials(name)}
    </span>
  );
}

const priorityStyles: Record<Priority, string> = {
  high: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  low: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={clsx(
        'rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize',
        priorityStyles[priority],
      )}
    >
      {priority}
    </span>
  );
}

const statusStyles: Record<ContactStatus, string> = {
  lead: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  prospect: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  customer: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  inactive: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

export function StatusBadge({ status }: { status: ContactStatus }) {
  return (
    <span
      className={clsx(
        'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        statusStyles[status],
      )}
    >
      {status}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={clsx(
        'inline-block size-5 animate-spin rounded-full border-2 border-accent border-t-transparent',
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-surface-2', className)} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="text-sm text-muted">{children}</p>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
    >
      {children}
    </p>
  );
}
