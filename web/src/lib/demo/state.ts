import {
  generateDemoDataset,
  type ActivityMeta,
  type ActivityType,
  type ContactStatus,
  type Priority,
  type Role,
  type Stage,
} from '@flowdesk/shared';

/** JSON-serialisable rows of the in-browser database (dates are ISO strings). */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatarColor: string;
  password: string;
  createdAt: string;
}

export interface ContactRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  company: string | null;
  title: string | null;
  status: ContactStatus;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealRow {
  id: string;
  title: string;
  value: number;
  stageId: string;
  position: number;
  priority: Priority;
  contactId: string | null;
  ownerId: string;
  expectedCloseDate: string | null;
  closedAt: string | null;
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRow {
  id: string;
  dealId: string;
  userId: string | null;
  type: ActivityType;
  message: string;
  meta: ActivityMeta | null;
  createdAt: string;
}

export interface RefreshTokenRow {
  token: string;
  familyId: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface DemoState {
  version: number;
  seq: number;
  users: UserRow[];
  stages: Stage[];
  contacts: ContactRow[];
  deals: DealRow[];
  activities: ActivityRow[];
  refreshTokens: RefreshTokenRow[];
}

export const STATE_VERSION = 1;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function createInitialState(now: Date = new Date()): DemoState {
  const data = generateDemoDataset({ now });
  return {
    version: STATE_VERSION,
    seq: 0,
    users: data.users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    stages: data.stages.map((s) => ({ ...s })),
    contacts: data.contacts.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    deals: data.deals.map((d) => ({
      ...d,
      expectedCloseDate: iso(d.expectedCloseDate),
      closedAt: iso(d.closedAt),
      stageChangedAt: d.stageChangedAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    })),
    activities: data.activities.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    refreshTokens: [],
  };
}

export interface StateStorage {
  load(): DemoState | null;
  save(state: DemoState): void;
  clear(): void;
}

const KEY = 'flowdesk.demo-db.v1';

export function localStorageStateStorage(
  storage: Storage | null = typeof window === 'undefined' ? null : window.localStorage,
): StateStorage {
  return {
    load() {
      try {
        const raw = storage?.getItem(KEY);
        const state = raw ? (JSON.parse(raw) as DemoState) : null;
        return state?.version === STATE_VERSION ? state : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        storage?.setItem(KEY, JSON.stringify(state));
      } catch {
        /* quota exceeded or storage disabled: keep working in memory */
      }
    },
    clear() {
      try {
        storage?.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

export function memoryStateStorage(): StateStorage {
  let state: DemoState | null = null;
  return {
    load: () => (state ? structuredClone(state) : null),
    save: (s) => {
      state = structuredClone(s);
    },
    clear: () => {
      state = null;
    },
  };
}
