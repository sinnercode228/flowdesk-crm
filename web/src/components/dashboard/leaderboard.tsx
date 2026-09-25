import type { OwnerPerformance } from '@flowdesk/shared';
import { formatMoneyCompact, formatPercent } from '@/lib/format';
import { Avatar } from '../ui/misc';

export function Leaderboard({ rows }: { rows: OwnerPerformance[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="pb-2 font-medium">Owner</th>
            <th className="pb-2 text-right font-medium">Won</th>
            <th className="pb-2 text-right font-medium">Open</th>
            <th className="pb-2 text-right font-medium">Win rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.ownerId}>
              <td className="py-2.5">
                <span className="flex items-center gap-2">
                  <Avatar name={r.name} color={r.avatarColor} size="sm" />
                  <span className="truncate">{r.name}</span>
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {formatMoneyCompact(r.wonValue)}{' '}
                <span className="text-xs text-muted">({r.wonCount})</span>
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {formatMoneyCompact(r.openValue)}{' '}
                <span className="text-xs text-muted">({r.openCount})</span>
              </td>
              <td className="py-2.5 text-right tabular-nums">{formatPercent(r.winRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
