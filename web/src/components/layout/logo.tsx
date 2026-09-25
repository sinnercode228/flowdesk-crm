export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path
          d="M9 10h14M9 16h10M9 22h6"
          stroke="var(--accent-ink)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {!compact && <span className="text-lg">FlowDesk</span>}
    </span>
  );
}
