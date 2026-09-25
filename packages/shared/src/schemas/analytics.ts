import { z } from 'zod';
import { IdSchema } from './common';

export const AnalyticsSummarySchema = z.object({
  openCount: z.number().int(),
  openPipelineValue: z.number(),
  /** Sum of open deal values multiplied by their stage probability. */
  weightedPipelineValue: z.number(),
  wonCount: z.number().int(),
  wonValue: z.number(),
  lostCount: z.number().int(),
  /** won / (won + lost), 0..1 */
  winRate: z.number().min(0).max(1),
  avgWonDealSize: z.number(),
  wonValueThisMonth: z.number(),
  wonValuePrevMonth: z.number(),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

export const RevenueQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(12),
});

export const RevenuePointSchema = z.object({
  /** `YYYY-MM` (UTC). */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  wonValue: z.number(),
  wonCount: z.number().int(),
  /** Value of deals created in that month (new pipeline). */
  createdValue: z.number(),
});
export type RevenuePoint = z.infer<typeof RevenuePointSchema>;
export const RevenueByMonthSchema = z.array(RevenuePointSchema);

export const FunnelStepSchema = z.object({
  stageId: IdSchema,
  name: z.string(),
  color: z.string(),
  /** Deals that reached this stage or any later one. */
  count: z.number().int(),
  value: z.number(),
  conversionFromPrev: z.number().min(0).max(1).nullable(),
  conversionFromStart: z.number().min(0).max(1),
});
export type FunnelStep = z.infer<typeof FunnelStepSchema>;
export const FunnelSchema = z.array(FunnelStepSchema);

export const OwnerPerformanceSchema = z.object({
  ownerId: IdSchema,
  name: z.string(),
  avatarColor: z.string(),
  wonValue: z.number(),
  wonCount: z.number().int(),
  openValue: z.number(),
  openCount: z.number().int(),
  winRate: z.number().min(0).max(1),
});
export type OwnerPerformance = z.infer<typeof OwnerPerformanceSchema>;
export const LeaderboardSchema = z.array(OwnerPerformanceSchema);
