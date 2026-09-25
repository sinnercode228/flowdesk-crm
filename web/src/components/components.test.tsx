import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsSummary, Contact, Deal } from '@flowdesk/shared';
import { ContactsTable } from './contacts/contacts-table';
import { Pagination, pageWindow } from './contacts/pagination';
import { KpiCards } from './dashboard/kpi-cards';
import { DealCard } from './deals/deal-card';

const contact = (i: number): Contact => ({
  id: `ct_${i}`,
  firstName: `First${i}`,
  lastName: `Last${i}`,
  email: `person${i}@example.test`,
  phone: null,
  company: `Company ${i}`,
  title: null,
  status: 'lead',
  owner: { id: 'usr_admin', name: 'Alex Morgan', avatarColor: '#6366f1' },
  dealsCount: i,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('ContactsTable', () => {
  it('renders rows and reports sort clicks', async () => {
    const onSort = vi.fn();
    render(
      <ContactsTable contacts={[contact(1), contact(2)]} sort="name" order="asc" onSort={onSort} />,
    );
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(
      within(screen.getByRole('columnheader', { name: /company/i })).getByRole('button'),
    );
    expect(onSort).toHaveBeenCalledWith('company');
  });

  it('shows action buttons only when handlers are allowed', () => {
    const { rerender } = render(
      <ContactsTable contacts={[contact(1)]} sort="name" order="asc" onSort={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    rerender(
      <ContactsTable
        contacts={[contact(1)]}
        sort="name"
        order="asc"
        onSort={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete First1 Last1' })).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('computes a compact page window', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it('navigates and disables the edges', async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} totalPages={3} total={25} pageSize={10} onPage={onPage} />);
    expect(screen.getByText('1–10 of 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('KpiCards', () => {
  it('shows the month-over-month change', () => {
    const summary: AnalyticsSummary = {
      openCount: 3,
      openPipelineValue: 30000,
      weightedPipelineValue: 12000,
      wonCount: 4,
      wonValue: 40000,
      lostCount: 1,
      winRate: 0.8,
      avgWonDealSize: 10000,
      wonValueThisMonth: 15000,
      wonValuePrevMonth: 10000,
    };
    render(<KpiCards summary={summary} />);
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('+50%')).toBeInTheDocument();
    expect(screen.getByText('3 open deals')).toBeInTheDocument();
  });
});

describe('DealCard', () => {
  it('renders the essentials and a lock for foreign deals', () => {
    const deal: Deal = {
      id: 'deal_1',
      title: 'Analytics dashboard',
      value: 7500,
      currency: 'USD',
      stageId: 'stg_lead',
      position: 0,
      priority: 'high',
      contact: {
        id: 'ct_1',
        name: 'Lena Orlov',
        company: 'Nettlefield Clinic',
        email: 'lena@example.test',
      },
      owner: { id: 'usr_daniel', name: 'Daniel Reyes', avatarColor: '#14b8a6' },
      expectedCloseDate: null,
      closedAt: null,
      stageChangedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    render(<DealCard deal={deal} locked />);
    expect(screen.getByText('$7,500')).toBeInTheDocument();
    expect(screen.getByText(/Nettlefield Clinic/)).toBeInTheDocument();
    expect(screen.getByLabelText('Owned by another user')).toBeInTheDocument();
  });
});
