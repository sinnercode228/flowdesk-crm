import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import {
  AnalyticsSummarySchema,
  FunnelSchema,
  LeaderboardSchema,
  RevenueByMonthSchema,
  RevenueQuerySchema,
  computeFunnel,
  computeLeaderboard,
  computeRevenueByMonth,
  computeSummary,
  type AnalyticsStage,
  type StageKind,
} from '@flowdesk/shared';
import { errorResponses, secured } from '../../lib/openapi';

/**
 * Loads the minimal projection needed for analytics and delegates the maths to the shared
 * pure functions (also used by the in-browser demo API). For a CRM of this size this is
 * cheaper to maintain than provider-specific SQL; see README for the scaling notes.
 */
async function loadFacts(prisma: PrismaClient) {
  const [deals, stages] = await Promise.all([
    prisma.deal.findMany({
      select: { value: true, stageId: true, ownerId: true, createdAt: true, closedAt: true },
    }),
    prisma.stage.findMany({ orderBy: { position: 'asc' } }),
  ]);
  const typedStages: AnalyticsStage[] = stages.map((s) => ({ ...s, kind: s.kind as StageKind }));
  return { deals, stages: typedStages };
}

export const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/summary',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Pipeline KPIs',
        security: secured,
        response: { 200: AnalyticsSummarySchema, ...errorResponses(401) },
      },
    },
    async () => {
      const { deals, stages } = await loadFacts(app.prisma);
      return computeSummary(deals, stages);
    },
  );

  app.get(
    '/revenue-by-month',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Won revenue and new pipeline per month (UTC)',
        security: secured,
        querystring: RevenueQuerySchema,
        response: { 200: RevenueByMonthSchema, ...errorResponses(400, 401) },
      },
    },
    async (request) => {
      const { deals, stages } = await loadFacts(app.prisma);
      return computeRevenueByMonth(deals, stages, request.query.months);
    },
  );

  app.get(
    '/funnel',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Stage-to-stage conversion funnel',
        security: secured,
        response: { 200: FunnelSchema, ...errorResponses(401) },
      },
    },
    async () => {
      const { deals, stages } = await loadFacts(app.prisma);
      return computeFunnel(deals, stages);
    },
  );

  app.get(
    '/leaderboard',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Performance by deal owner',
        security: secured,
        response: { 200: LeaderboardSchema, ...errorResponses(401) },
      },
    },
    async () => {
      const [{ deals, stages }, users] = await Promise.all([
        loadFacts(app.prisma),
        app.prisma.user.findMany({ select: { id: true, name: true, avatarColor: true } }),
      ]);
      return computeLeaderboard(deals, stages, users);
    },
  );
};
