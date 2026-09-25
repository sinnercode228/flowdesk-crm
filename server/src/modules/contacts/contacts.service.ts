import type { Prisma, PrismaClient } from '@prisma/client';
import {
  type ContactListQuerySchema,
  can,
  type Contact,
  type ContactListResponse,
  type ContactSortField,
  type CreateContactSchema,
  type SortOrder,
  type UpdateContactSchema,
} from '@flowdesk/shared';
import type { z } from 'zod';
import { containsInsensitive, containsInsensitiveNullable } from '../../lib/db';
import { contactInclude, toContactDto } from '../../lib/dto';
import { forbidden, notFound } from '../../lib/errors';
import type { AuthUser } from '../../lib/tokens';

type ListQuery = z.output<typeof ContactListQuerySchema>;
type CreateContactData = z.output<typeof CreateContactSchema>;
type UpdateContactData = z.output<typeof UpdateContactSchema>;

function orderBy(
  sort: ContactSortField,
  order: SortOrder,
): Prisma.ContactOrderByWithRelationInput[] {
  const primary: Prisma.ContactOrderByWithRelationInput[] =
    sort === 'name' ? [{ lastName: order }, { firstName: order }] : [{ [sort]: order }];
  // Tie-breaker keeps pagination stable.
  return [...primary, { id: 'asc' }];
}

export class ContactsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sqlite: boolean,
  ) {}

  async list(query: ListQuery): Promise<ContactListResponse> {
    const q = query.search;
    const where: Prisma.ContactWhereInput = {
      status: query.status,
      ...(q
        ? {
            OR: [
              { firstName: containsInsensitive(q, this.sqlite) },
              { lastName: containsInsensitive(q, this.sqlite) },
              { email: containsInsensitive(q, this.sqlite) },
              { company: containsInsensitiveNullable(q, this.sqlite) },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        include: contactInclude,
        orderBy: orderBy(query.sort, query.order),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map(toContactDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string): Promise<Contact> {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: contactInclude,
    });
    if (!contact) throw notFound('Contact');
    return toContactDto(contact);
  }

  async create(input: CreateContactData, actor: AuthUser): Promise<Contact> {
    if (!can(actor, 'contact:create')) throw forbidden();
    const contact = await this.prisma.contact.create({
      data: { ...input, ownerId: actor.id },
      include: contactInclude,
    });
    return toContactDto(contact);
  }

  async update(id: string, input: UpdateContactData, actor: AuthUser): Promise<Contact> {
    if (!can(actor, 'contact:update')) throw forbidden();
    await this.get(id);
    const contact = await this.prisma.contact.update({
      where: { id },
      data: input,
      include: contactInclude,
    });
    return toContactDto(contact);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    if (!can(actor, 'contact:delete')) throw forbidden('Only admins can delete contacts');
    await this.get(id);
    // Deals keep their history; the relation is set to NULL by the database.
    await this.prisma.contact.delete({ where: { id } });
  }
}
