import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal, DealDetail, Stage, User } from '@flowdesk/shared';

const moveMutate = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useDeal: () => ({ data: dealDetail, isPending: false, isFetching: false, error: null }),
  useDeals: () => ({ data: boardDeals, isPending: false, error: null }),
  useMoveDeal: () => ({ mutate: moveMutate, isPending: false, error: null }),
  useUpdateDeal: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteDeal: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'usr_admin', name: 'Alex', avatarColor: '#ffffff' },
    can: () => true,
    login: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
  }),
}));

import { DealDrawer } from './deal-drawer';

const stages: Stage[] = [
  { id: 'stg_lead', name: 'Lead', probability: 10, position: 0, kind: 'open', color: '#6366f1' },
  {
    id: 'stg_qualified',
    name: 'Qualified',
    probability: 40,
    position: 1,
    kind: 'open',
    color: '#6366f1',
  },
  { id: 'stg_won', name: 'Won', probability: 100, position: 2, kind: 'won', color: '#10b981' },
];

const users: User[] = [
  {
    id: 'usr_admin',
    name: 'Alex',
    email: 'a@x.test',
    role: 'admin',
    avatarColor: '#ffffff',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const deal = (id: string, stageId: string, position: number): Deal => ({
  id,
  title: `Deal ${id}`,
  value: 1000,
  currency: 'USD',
  stageId,
  position,
  priority: 'medium',
  contact: null,
  owner: { id: 'usr_admin', name: 'Alex', avatarColor: '#ffffff' },
  expectedCloseDate: null,
  closedAt: null,
  stageChangedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const dealDetail: DealDetail = { ...deal('deal_mover', 'stg_lead', 0), activities: [] };

// Target column already has three cards; drawer must not shove the moved card to the top.
const boardDeals: Deal[] = [
  dealDetail,
  deal('deal_q1', 'stg_qualified', 0),
  deal('deal_q2', 'stg_qualified', 1),
  deal('deal_q3', 'stg_qualified', 2),
];

describe('DealDrawer stage selector', () => {
  beforeEach(() => {
    moveMutate.mockReset();
  });

  it('appends to the end of the target column instead of position 0', async () => {
    render(<DealDrawer dealId="deal_mover" onClose={() => {}} stages={stages} users={users} />);
    await userEvent.selectOptions(screen.getByLabelText(/Stage/), 'stg_qualified');
    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(moveMutate).toHaveBeenCalledWith({
      id: 'deal_mover',
      stageId: 'stg_qualified',
      position: 3,
    });
  });

  it('does not call move when the current stage is selected again', async () => {
    render(<DealDrawer dealId="deal_mover" onClose={() => {}} stages={stages} users={users} />);
    await userEvent.selectOptions(screen.getByLabelText(/Stage/), 'stg_lead');
    expect(moveMutate).not.toHaveBeenCalled();
  });
});
