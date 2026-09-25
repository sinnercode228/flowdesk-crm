/**
 * Deterministic demo dataset. Used by the server seed script and by the in-browser
 * demo API, so both backends start from the same data.
 *
 * Every company, person, e-mail and phone number here is generated and fictional:
 * e-mails use the reserved `.example` TLD, phone numbers the reserved 555-01XX range.
 */
import type { ActivityMeta, ActivityType, Priority } from './schemas/deal';
import type { ContactStatus } from './schemas/contact';
import type { StageKind } from './schemas/stage';
import type { Role } from './schemas/user';
import { DEMO_ACCOUNTS } from './schemas/auth';

export interface DemoUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatarColor: string;
  /** Plain-text demo password. The server hashes it while seeding. */
  password: string;
  createdAt: Date;
}

export interface DemoStage {
  id: string;
  name: string;
  position: number;
  probability: number;
  kind: StageKind;
  color: string;
}

export interface DemoContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  company: string | null;
  title: string | null;
  status: ContactStatus;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DemoDeal {
  id: string;
  title: string;
  value: number;
  stageId: string;
  position: number;
  priority: Priority;
  contactId: string | null;
  ownerId: string;
  expectedCloseDate: Date | null;
  closedAt: Date | null;
  stageChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DemoActivity {
  id: string;
  dealId: string;
  userId: string | null;
  type: ActivityType;
  message: string;
  meta: ActivityMeta | null;
  createdAt: Date;
}

export interface DemoDataset {
  users: DemoUser[];
  stages: DemoStage[];
  contacts: DemoContact[];
  deals: DemoDeal[];
  activities: DemoActivity[];
}

export interface DemoDatasetOptions {
  now?: Date;
  seed?: number;
  contacts?: number;
}

/** mulberry32: tiny, fast, deterministic PRNG. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}

const DAY = 86_400_000;

export const DEMO_STAGES: DemoStage[] = [
  { id: 'stg_lead', name: 'Lead', position: 0, probability: 10, kind: 'open', color: '#64748b' },
  {
    id: 'stg_qualified',
    name: 'Qualified',
    position: 1,
    probability: 25,
    kind: 'open',
    color: '#0ea5e9',
  },
  {
    id: 'stg_proposal',
    name: 'Proposal',
    position: 2,
    probability: 50,
    kind: 'open',
    color: '#8b5cf6',
  },
  {
    id: 'stg_negotiation',
    name: 'Negotiation',
    position: 3,
    probability: 75,
    kind: 'open',
    color: '#f59e0b',
  },
  { id: 'stg_won', name: 'Won', position: 4, probability: 100, kind: 'won', color: '#10b981' },
  { id: 'stg_lost', name: 'Lost', position: 5, probability: 0, kind: 'lost', color: '#f43f5e' },
];

const TEAM: Array<Omit<DemoUser, 'createdAt' | 'password'>> = [
  {
    id: 'usr_admin',
    email: DEMO_ACCOUNTS.admin.email,
    name: 'Alex Morgan',
    role: 'admin',
    avatarColor: '#6366f1',
  },
  {
    id: 'usr_manager',
    email: DEMO_ACCOUNTS.manager.email,
    name: 'Maria Sokolova',
    role: 'manager',
    avatarColor: '#ec4899',
  },
  {
    id: 'usr_daniel',
    email: 'daniel@flowdesk.example',
    name: 'Daniel Reyes',
    role: 'manager',
    avatarColor: '#14b8a6',
  },
  {
    id: 'usr_nina',
    email: 'nina@flowdesk.example',
    name: 'Nina Park',
    role: 'manager',
    avatarColor: '#f97316',
  },
];

const COMPANIES = [
  'Brightmoor Analytics',
  'Cobaltcrane Logistics',
  'Driftwood Coffee Co.',
  'Emberline Studio',
  'Fernhill Dental',
  'Glasswing Robotics',
  'Harborlight Media',
  'Ironbark Builders',
  'Juniper Hollow Farms',
  'Kitefield Academy',
  'Lanternfish Games',
  'Mossgate Realty',
  'Nettlefield Clinic',
  'Oakspire Legal',
  'Pebblestone Travel',
  'Quillmark Publishing',
  'Rivertide Fitness',
  'Saltmarsh Outfitters',
  'Thistlewood Bakery',
  'Umberfield Energy',
  'Velvetleaf Apparel',
  'Willowbrook Pets',
  'Yarrowfield Labs',
  'Zephyrine Aero',
] as const;

const FIRST_NAMES = [
  'Olivia',
  'Artem',
  'Hana',
  'Lucas',
  'Priya',
  'Mateo',
  'Elena',
  'Noah',
  'Amara',
  'Ivan',
  'Chloe',
  'Kenji',
  'Sofia',
  'Omar',
  'Lena',
  'Viktor',
  'Grace',
  'Diego',
  'Anya',
  'Samuel',
  'Mila',
  'Ethan',
  'Zara',
  'Timur',
] as const;

const LAST_NAMES = [
  'Bennett',
  'Sokolov',
  'Tanaka',
  'Moreau',
  'Raman',
  'Alvarez',
  'Varga',
  'Fischer',
  'Okafor',
  'Petrov',
  'Laurent',
  'Nakamura',
  'Costa',
  'Haddad',
  'Novak',
  'Orlov',
  'Whitfield',
  'Romero',
  'Kowalski',
  'Lindqvist',
  'Brennan',
  'Castillo',
  'Mendes',
  'Asanov',
] as const;

const JOB_TITLES = [
  'Head of Operations',
  'CTO',
  'Marketing Director',
  'Product Manager',
  'Founder & CEO',
  'Procurement Lead',
  'VP of Sales',
  'Office Manager',
  'Head of Growth',
  'IT Director',
] as const;

const DEAL_TOPICS = [
  'Website redesign',
  'Annual support contract',
  'CRM onboarding',
  'Data migration',
  'Mobile app MVP',
  'Analytics dashboard',
  'Cloud cost audit',
  'Team training program',
  'Payment gateway integration',
  'E-commerce storefront',
  'Customer portal',
  'Security review',
  'Inventory automation',
  'Booking system',
  'Loyalty program',
  'Internal tools revamp',
] as const;

const NOTES = [
  'Discovery call went well, they want a proposal by Friday.',
  'Sent the pricing breakdown, waiting for feedback from finance.',
  'Decision maker joins the next call — prepare a short demo.',
  'Asked for two customer-facing milestones instead of one big release.',
  'Legal review of the contract is in progress.',
  'Budget confirmed for this quarter.',
  'Follow up after their internal planning session next week.',
  'They compared us with an in-house option; highlighted maintenance costs.',
] as const;

const AREA_CODES = ['212', '415', '312', '646', '206', '617'] as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function roundTo(value: number, step: number) {
  return Math.max(step, Math.round(value / step) * step);
}

export function generateDemoDataset(options: DemoDatasetOptions = {}): DemoDataset {
  const now = options.now ?? new Date();
  const rng = createRng(options.seed ?? 20260924);
  const contactCount = options.contacts ?? 60;
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const clampPast = (d: Date) =>
    d.getTime() > now.getTime() - 3_600_000 ? new Date(now.getTime() - 3_600_000) : d;

  const users: DemoUser[] = TEAM.map((u, i) => ({
    ...u,
    password: DEMO_ACCOUNTS.admin.password,
    createdAt: ago(420 - i * 20),
  }));
  // The demo manager owns a larger share so the "manager" login has plenty to work with.
  const ownerPool = [
    'usr_manager',
    'usr_manager',
    'usr_daniel',
    'usr_nina',
    'usr_admin',
    'usr_manager',
    'usr_daniel',
    'usr_nina',
  ];

  const contacts: DemoContact[] = [];
  const usedEmails = new Set<string>();
  for (let i = 0; i < contactCount; i++) {
    const firstName = FIRST_NAMES[(i * 7 + rng.int(0, 3)) % FIRST_NAMES.length]!;
    const company = COMPANIES[i % COMPANIES.length]!;
    // Avoid two people with the same name at the same company: step to the next surname.
    let lastIdx = (i * 5 + rng.int(0, 5)) % LAST_NAMES.length;
    const emailFor = (last: string) => `${slug(firstName)}.${slug(last)}@${slug(company)}.example`;
    while (usedEmails.has(emailFor(LAST_NAMES[lastIdx]!)))
      lastIdx = (lastIdx + 1) % LAST_NAMES.length;
    const lastName = LAST_NAMES[lastIdx]!;
    const email = emailFor(lastName);
    usedEmails.add(email);
    const createdAt = ago(rng.int(5, 400));
    contacts.push({
      id: `con_${String(i + 1).padStart(3, '0')}`,
      firstName,
      lastName,
      email,
      phone: rng.chance(0.85)
        ? `+1 (${rng.pick(AREA_CODES)}) 555-01${String(rng.int(0, 99)).padStart(2, '0')}`
        : null,
      company,
      title: rng.pick(JOB_TITLES),
      status: 'lead',
      ownerId: rng.pick(ownerPool),
      createdAt,
      updatedAt: createdAt,
    });
  }

  const deals: DemoDeal[] = [];
  const positions = new Map<string, number>();
  let dealSeq = 0;

  const addDeal = (stage: DemoStage, createdAt: Date, closedAt: Date | null, value: number) => {
    dealSeq++;
    const contact = contacts[(dealSeq * 11) % contacts.length]!;
    const position = positions.get(stage.id) ?? 0;
    positions.set(stage.id, position + 1);
    const stageChangedAt =
      closedAt ?? clampPast(new Date(createdAt.getTime() + rng.int(0, 12) * DAY));
    const priority: Priority =
      value > 30_000
        ? 'high'
        : value > 12_000
          ? rng.pick(['medium', 'high'])
          : rng.pick(['low', 'medium']);
    deals.push({
      id: `deal_${String(dealSeq).padStart(3, '0')}`,
      title: `${rng.pick(DEAL_TOPICS)} — ${contact.company}`,
      value,
      stageId: stage.id,
      position,
      priority,
      contactId: contact.id,
      ownerId: contact.ownerId ?? 'usr_admin',
      expectedCloseDate:
        stage.kind === 'open' ? new Date(now.getTime() + rng.int(7, 75) * DAY) : null,
      closedAt,
      stageChangedAt,
      createdAt,
      updatedAt: stageChangedAt,
    });
    if (contact.createdAt.getTime() > createdAt.getTime()) {
      contact.createdAt = new Date(createdAt.getTime() - rng.int(1, 20) * DAY);
      contact.updatedAt = contact.createdAt;
    }
    if (stage.kind === 'won') contact.status = 'customer';
    else if (stage.kind === 'open' && contact.status !== 'customer') contact.status = 'prospect';
  };

  const stage = (id: string) => DEMO_STAGES.find((s) => s.id === id)!;

  // Won deals: an upward revenue trend over the last 12 months.
  const wonPerMonth = [1, 1, 2, 1, 2, 2, 2, 3, 2, 3, 3, 2];
  wonPerMonth.forEach((count, i) => {
    const monthsAgo = 11 - i;
    for (let k = 0; k < count; k++) {
      const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1);
      const closedAt = clampPast(
        new Date(monthStart + rng.int(0, 26) * DAY + rng.int(9, 17) * 3_600_000),
      );
      const createdAt = new Date(closedAt.getTime() - rng.int(14, 70) * DAY);
      addDeal(
        stage('stg_won'),
        createdAt,
        closedAt,
        roundTo(3_500 + i * 1_100 + rng.next() * 14_000, 500),
      );
    }
  });

  // Lost deals.
  for (let k = 0; k < 8; k++) {
    const closedAt = ago(rng.int(3, 330));
    addDeal(
      stage('stg_lost'),
      new Date(closedAt.getTime() - rng.int(10, 45) * DAY),
      closedAt,
      roundTo(2_000 + rng.next() * 25_000, 500),
    );
  }

  // Open pipeline, narrowing towards the later stages.
  const openPlan: Array<[string, number]> = [
    ['stg_lead', 7],
    ['stg_qualified', 6],
    ['stg_proposal', 5],
    ['stg_negotiation', 4],
  ];
  for (const [stageId, count] of openPlan) {
    for (let k = 0; k < count; k++) {
      addDeal(stage(stageId), ago(rng.int(2, 80)), null, roundTo(1_500 + rng.next() * 45_000, 500));
    }
  }

  for (const c of contacts) {
    if (c.status === 'lead' && rng.chance(0.25)) c.status = 'inactive';
  }

  const activities: DemoActivity[] = [];
  let actSeq = 0;
  const addActivity = (a: Omit<DemoActivity, 'id'>) => {
    actSeq++;
    activities.push({ id: `act_${String(actSeq).padStart(4, '0')}`, ...a });
  };
  const firstStage = DEMO_STAGES[0]!;
  for (const deal of deals) {
    addActivity({
      dealId: deal.id,
      userId: deal.ownerId,
      type: 'created',
      message: 'Deal created',
      meta: null,
      createdAt: deal.createdAt,
    });
    if (rng.chance(0.6)) {
      addActivity({
        dealId: deal.id,
        userId: deal.ownerId,
        type: 'note',
        message: rng.pick(NOTES),
        meta: null,
        createdAt: new Date(
          deal.createdAt.getTime() +
            Math.max(1, (deal.stageChangedAt.getTime() - deal.createdAt.getTime()) / 2),
        ),
      });
    }
    if (deal.stageId !== firstStage.id) {
      const to = stage(deal.stageId).name;
      addActivity({
        dealId: deal.id,
        userId: deal.ownerId,
        type: 'stage_changed',
        message: `Moved from ${firstStage.name} to ${to}`,
        meta: { from: firstStage.name, to },
        createdAt: deal.stageChangedAt,
      });
    }
  }

  return { users, stages: DEMO_STAGES.map((s) => ({ ...s })), contacts, deals, activities };
}
