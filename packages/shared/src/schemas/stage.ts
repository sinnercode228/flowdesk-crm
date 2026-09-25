import { z } from 'zod';
import { IdSchema } from './common';

export const STAGE_KINDS = ['open', 'won', 'lost'] as const;
export const StageKindSchema = z.enum(STAGE_KINDS);
export type StageKind = z.infer<typeof StageKindSchema>;

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex color like #6366f1');

export const StageSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(40),
  position: z.number().int().min(0),
  /** Win probability used for the weighted forecast, 0..100. */
  probability: z.number().int().min(0).max(100),
  kind: StageKindSchema,
  color: HexColorSchema,
});
export type Stage = z.infer<typeof StageSchema>;

export const StageListSchema = z.array(StageSchema);

export const CreateStageSchema = z.object({
  name: z.string().trim().min(1).max(40),
  probability: z.number().int().min(0).max(100),
  kind: StageKindSchema.default('open'),
  color: HexColorSchema.default('#6366f1'),
});
export type CreateStageInput = z.input<typeof CreateStageSchema>;

export const UpdateStageSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    probability: z.number().int().min(0).max(100),
    kind: StageKindSchema,
    color: HexColorSchema,
    position: z.number().int().min(0),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateStageInput = z.infer<typeof UpdateStageSchema>;
