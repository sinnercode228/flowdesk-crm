'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContactListQuery,
  CreateContactInput,
  CreateDealInput,
  Deal,
  MoveDealInput,
  UpdateContactInput,
  UpdateDealInput,
} from '@flowdesk/shared';
import { getApi } from '@/lib/api';
import { applyMove } from '@/lib/kanban';

export const keys = {
  stages: ['stages'] as const,
  users: ['users'] as const,
  deals: ['deals'] as const,
  deal: (id: string) => ['deals', id] as const,
  contacts: (q: ContactListQuery) => ['contacts', q] as const,
  analytics: ['analytics'] as const,
};

export const useStages = () =>
  useQuery({ queryKey: keys.stages, queryFn: () => getApi().stages.list() });
export const useUsers = () =>
  useQuery({ queryKey: keys.users, queryFn: () => getApi().users.list() });
export const useDeals = () =>
  useQuery({ queryKey: keys.deals, queryFn: () => getApi().deals.list() });

export const useDeal = (id: string | null) =>
  useQuery({
    queryKey: keys.deal(id ?? ''),
    queryFn: () => getApi().deals.get(id!),
    enabled: Boolean(id),
  });

export const useContacts = (query: ContactListQuery) =>
  useQuery({
    queryKey: keys.contacts(query),
    queryFn: () => getApi().contacts.list(query),
    placeholderData: keepPreviousData,
  });

export const useContactOptions = () =>
  useQuery({
    queryKey: ['contacts', 'options'],
    queryFn: () => getApi().contacts.list({ pageSize: 100, sort: 'name', order: 'asc' }),
    staleTime: 60_000,
  });

export const useAnalytics = () =>
  useQuery({
    queryKey: keys.analytics,
    queryFn: async () => {
      const api = getApi();
      const [summary, revenue, funnel, leaderboard] = await Promise.all([
        api.analytics.summary(),
        api.analytics.revenueByMonth(12),
        api.analytics.funnel(),
        api.analytics.leaderboard(),
      ]);
      return { summary, revenue, funnel, leaderboard };
    },
  });

function useInvalidateDeals() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: keys.deals, exact: !id });
    if (id) void qc.invalidateQueries({ queryKey: keys.deal(id) });
    void qc.invalidateQueries({ queryKey: keys.analytics });
  };
}

/** Optimistic drag-and-drop move with rollback on error. */
export function useMoveDeal() {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeals();
  return useMutation({
    mutationFn: ({ id, ...input }: MoveDealInput & { id: string }) =>
      getApi().deals.move(id, input),
    onMutate: async ({ id, stageId, position }) => {
      await qc.cancelQueries({ queryKey: keys.deals, exact: true });
      const previous = qc.getQueryData<Deal[]>(keys.deals);
      if (previous) qc.setQueryData<Deal[]>(keys.deals, applyMove(previous, id, stageId, position));
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) qc.setQueryData(keys.deals, context.previous);
    },
    onSettled: (_d, _e, { id }) => invalidate(id),
  });
}

export function useCreateDeal() {
  const invalidate = useInvalidateDeals();
  return useMutation({
    mutationFn: (input: CreateDealInput) => getApi().deals.create(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateDeal(id: string) {
  const invalidate = useInvalidateDeals();
  return useMutation({
    mutationFn: (input: UpdateDealInput) => getApi().deals.update(id, input),
    onSuccess: () => invalidate(id),
  });
}

export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => getApi().deals.addNote(id, message),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.deal(id) }),
  });
}

export function useDeleteDeal() {
  const invalidate = useInvalidateDeals();
  return useMutation({
    mutationFn: (id: string) => getApi().deals.remove(id),
    onSuccess: () => invalidate(),
  });
}

function useInvalidateContacts() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['contacts'] });
    void qc.invalidateQueries({ queryKey: keys.deals });
  };
}

export function useSaveContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreateContactInput | UpdateContactInput }) =>
      id
        ? getApi().contacts.update(id, input)
        : getApi().contacts.create(input as CreateContactInput),
    onSuccess: invalidate,
  });
}

export function useDeleteContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (id: string) => getApi().contacts.remove(id),
    onSuccess: invalidate,
  });
}
