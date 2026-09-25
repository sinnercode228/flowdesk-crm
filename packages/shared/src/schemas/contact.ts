import { z } from 'zod';
import {
  IdSchema,
  IsoDateTimeSchema,
  PaginationQuerySchema,
  SortOrderSchema,
  paginatedSchema,
} from './common';
import { UserRefSchema } from './user';

export const CONTACT_STATUSES = ['lead', 'prospect', 'customer', 'inactive'] as const;
export const ContactStatusSchema = z.enum(CONTACT_STATUSES);
export type ContactStatus = z.infer<typeof ContactStatusSchema>;

export const ContactSchema = z.object({
  id: IdSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  title: z.string().nullable(),
  status: ContactStatusSchema,
  owner: UserRefSchema.nullable(),
  dealsCount: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Contact = z.infer<typeof ContactSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const CreateContactSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: optionalText(40),
  company: optionalText(120),
  title: optionalText(120),
  status: ContactStatusSchema.default('lead'),
});
export type CreateContactInput = z.input<typeof CreateContactSchema>;

export const UpdateContactSchema = CreateContactSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one field is required' },
);
export type UpdateContactInput = z.input<typeof UpdateContactSchema>;

export const CONTACT_SORT_FIELDS = ['name', 'company', 'email', 'status', 'createdAt'] as const;
export const ContactSortFieldSchema = z.enum(CONTACT_SORT_FIELDS);
export type ContactSortField = z.infer<typeof ContactSortFieldSchema>;

export const ContactListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: ContactStatusSchema.optional(),
  sort: ContactSortFieldSchema.default('createdAt'),
  order: SortOrderSchema.default('desc'),
});
/** Client-side query type (`page`/`pageSize` are coerced from strings on the server). */
export type ContactListQuery = Omit<z.input<typeof ContactListQuerySchema>, 'page' | 'pageSize'> & {
  page?: number;
  pageSize?: number;
};

export const ContactListResponseSchema = paginatedSchema(ContactSchema);
export type ContactListResponse = z.infer<typeof ContactListResponseSchema>;
