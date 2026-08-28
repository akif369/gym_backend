import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../common/auth/requireAuth';
import { getDashboardService } from './dashboard.service';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', { preHandler: [requireAuth], schema: { tags: ['Dashboard'], summary: 'Live organization dashboard summary' } }, async (request) => {
    const query = request.query as { branchId?: string };
    const ctx = request.user;
    if (query.branchId) {
      ctx.activeBranchId = query.branchId;
    }
    return getDashboardService(ctx);
  });
}
