import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common';
import { UserRefSchema } from './user';

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const PrioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof PrioritySchema>;

export const MAX_DEAL_VALUE = 100_000_000;

export const DealContactRefSchema = z.object({
  id: IdSchema,
  name: z.string(),
  company: z.string().nullable(),
  email: z.string(),
});
export type DealContactRef = z.infer<typeof DealContactRefSchema>;

export const DealSchema = z.object({
  id: IdSchema,
  title: z.string(),
  /** Whole currency units (USD). */
  value: z.number().int().min(0),
  currency: z.literal('USD'),
  stageId: IdSchema,
  /** Zero-based order of the card inside its stage column. */
  position: z.number().int().min(0),
  priority: PrioritySchema,
  contact: DealContactRefSchema.nullable(),
  owner: UserRefSchema,
  expectedCloseDate: IsoDateTimeSchema.nullable(),
  closedAt: IsoDateTimeSchema.nullable(),
  stageChangedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Deal = z.infer<typeof DealSchema>;

export const DealListSchema = z.array(DealSchema);

/** Accepts `YYYY-MM-DD` or a full ISO timestamp, normalised to an ISO timestamp. */
const DateInputSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((v) => new Date(v.length === 10 ? `${v}T12:00:00.000Z` : v).toISOString());

export const CreateDealSchema = z.object({
  title: z.string().trim().min(2).max(120),
  value: z.number().int().min(0).max(MAX_DEAL_VALUE),
  stageId: IdSchema,
  priority: PrioritySchema.default('medium'),
  contactId: IdSchema.nullish(),
  ownerId: IdSchema.optional(),
  expectedCloseDate: DateInputSchema.nullish(),
});
export type CreateDealInput = z.input<typeof CreateDealSchema>;

export const UpdateDealSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    value: z.number().int().min(0).max(MAX_DEAL_VALUE),
    priority: PrioritySchema,
    contactId: IdSchema.nullable(),
    ownerId: IdSchema,
    expectedCloseDate: DateInputSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateDealInput = z.input<typeof UpdateDealSchema>;

export const MoveDealSchema = z.object({
  stageId: IdSchema,
  position: z.number().int().min(0),
});
export type MoveDealInput = z.infer<typeof MoveDealSchema>;

export const DealListQuerySchema = z.object({
  stageId: IdSchema.optional(),
  ownerId: IdSchema.optional(),
  priority: PrioritySchema.optional(),
  search: z.string().trim().max(100).optional(),
});
export type DealListQuery = z.infer<typeof DealListQuerySchema>;

export const ACTIVITY_TYPES = ['created', 'stage_changed', 'updated', 'note'] as const;
export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/** Structured payload of system events, so clients can render them in any language. */
export const ActivityMetaSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  fields: z.array(z.string()).optional(),
});
export type ActivityMeta = z.infer<typeof ActivityMetaSchema>;

export const ActivitySchema = z.object({
  id: IdSchema,
  dealId: IdSchema,
  type: ActivityTypeSchema,
  /** Note text, or an English fallback description for system events. */
  message: z.string(),
  meta: ActivityMetaSchema.nullable(),
  author: UserRefSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Activity = z.infer<typeof ActivitySchema>;

export const DealDetailSchema = DealSchema.extend({
  activities: z.array(ActivitySchema),
});
export type DealDetail = z.infer<typeof DealDetailSchema>;

export const CreateNoteSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
