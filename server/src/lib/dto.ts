/**
 * Mapping from Prisma rows to the wire DTOs defined in @flowdesk/shared.
 * Response schemas validate these shapes before they leave the server.
 */
import type { Prisma, Stage as StageRow, User as UserRow } from '@prisma/client';
import {
  ActivityMetaSchema,
  type Activity,
  type Contact,
  type ContactStatus,
  type Deal,
  type DealDetail,
  type Priority,
  type Role,
  type Stage,
  type StageKind,
  type User,
} from '@flowdesk/shared';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

const userRefSelect = { id: true, name: true, avatarColor: true } as const;

export const dealInclude = {
  owner: { select: userRefSelect },
  contact: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
} satisfies Prisma.DealInclude;

export const dealDetailInclude = {
  ...dealInclude,
  activities: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { user: { select: userRefSelect } },
  },
} satisfies Prisma.DealInclude;

export const contactInclude = {
  owner: { select: userRefSelect },
  _count: { select: { deals: true } },
} satisfies Prisma.ContactInclude;

type DealRow = Prisma.DealGetPayload<{ include: typeof dealInclude }>;
type DealDetailRow = Prisma.DealGetPayload<{ include: typeof dealDetailInclude }>;
type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;
type ActivityRow = DealDetailRow['activities'][number];

export function toUserDto(user: UserRow): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    avatarColor: user.avatarColor,
    createdAt: iso(user.createdAt),
  };
}

export function toStageDto(stage: StageRow): Stage {
  return {
    id: stage.id,
    name: stage.name,
    position: stage.position,
    probability: stage.probability,
    kind: stage.kind as StageKind,
    color: stage.color,
  };
}

export function toDealDto(deal: DealRow): Deal {
  return {
    id: deal.id,
    title: deal.title,
    value: deal.value,
    currency: 'USD',
    stageId: deal.stageId,
    position: deal.position,
    priority: deal.priority as Priority,
    contact: deal.contact
      ? {
          id: deal.contact.id,
          name: `${deal.contact.firstName} ${deal.contact.lastName}`,
          company: deal.contact.company,
          email: deal.contact.email,
        }
      : null,
    owner: deal.owner,
    expectedCloseDate: isoOrNull(deal.expectedCloseDate),
    closedAt: isoOrNull(deal.closedAt),
    stageChangedAt: iso(deal.stageChangedAt),
    createdAt: iso(deal.createdAt),
    updatedAt: iso(deal.updatedAt),
  };
}

function parseMeta(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = ActivityMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function toActivityDto(activity: ActivityRow): Activity {
  return {
    id: activity.id,
    dealId: activity.dealId,
    type: activity.type as Activity['type'],
    message: activity.message,
    meta: parseMeta(activity.meta),
    author: activity.user,
    createdAt: iso(activity.createdAt),
  };
}

export function toDealDetailDto(deal: DealDetailRow): DealDetail {
  return { ...toDealDto(deal), activities: deal.activities.map(toActivityDto) };
}

export function toContactDto(contact: ContactRow): Contact {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    company: contact.company,
    title: contact.title,
    status: contact.status as ContactStatus,
    owner: contact.owner,
    dealsCount: contact._count.deals,
    createdAt: iso(contact.createdAt),
    updatedAt: iso(contact.updatedAt),
  };
}
