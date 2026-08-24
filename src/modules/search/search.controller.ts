import type { FastifyReply, FastifyRequest } from 'fastify';
import { globalSearchService } from './search.service';

export const searchController = {
  async search(request: FastifyRequest<{ Querystring: { q?: string } }>, reply: FastifyReply) {
    const q = typeof request.query.q === 'string' ? request.query.q : '';
    const user = {
      role: request.user.role,
      permissions: request.user.permissions,
      branchId: request.user.branchId,
    };
    return reply.send(await globalSearchService(request.user.orgId, q, user));
  },
};
