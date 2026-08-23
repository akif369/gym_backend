import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifySensible from '@fastify/sensible';
import { config } from './config/env';
import { logger } from './common/logger/index';
import { registerErrorHandler } from './common/errors/errorHandler';

// Plugins
import { registerCors } from './plugins/cors';
import { registerHelmet } from './plugins/helmet';
import { registerRateLimit } from './plugins/rateLimit';
import { registerJwt } from './plugins/jwt';
import { registerSwagger } from './plugins/swagger';
import { registerMultipart } from './plugins/multipart';
import { registerCompress } from './plugins/compress';

// Routes
import { healthRoutes } from './modules/health/health.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { orgRoutes } from './modules/org/org.routes';
import { staffRoutes } from './modules/staff/staff.routes';
import { membersRoutes } from './modules/members/members.routes';
import { membershipsRoutes } from './modules/memberships/memberships.routes';
import { attendanceRoutes } from './modules/attendance/attendance.routes';
import { paymentsRoutes } from './modules/payments/payments.routes';
import { trainersRoutes } from './modules/trainers/trainers.routes';
import { ptRoutes } from './modules/pt/pt.routes';
import { leadsRoutes } from './modules/leads/leads.routes';
import { workoutsRoutes } from './modules/workouts/workouts.routes';
import { reportsRoutes } from './modules/reports/reports.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { searchRoutes } from './modules/search/search.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { storageRoutes } from './modules/storage/storage.routes';

export async function buildApp() {
  const fastify = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    // Serialize JSON responses
    ajv: {
      customOptions: {
        removeAdditional: false,
        useDefaults: true,
        coerceTypes: false,
      },
    },
  }) as unknown as FastifyInstance;

  // ── Add x-request-id to all responses ────────────────────────────────────────
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('x-request-id', request.id);
  });

  // ── Security plugins (order matters) ─────────────────────────────────────────
  await registerHelmet(fastify);
  await registerCors(fastify);
  await registerCompress(fastify);
  await registerRateLimit(fastify);
  await registerJwt(fastify);
  await registerMultipart(fastify);
  await fastify.register(fastifySensible);

  // ── OpenAPI/Swagger (must be before routes) ───────────────────────────────────
  await registerSwagger(fastify);

  // ── Global error handler ──────────────────────────────────────────────────────
  registerErrorHandler(fastify);

  // ── Health (no auth, no prefix) ───────────────────────────────────────────────
  await fastify.register(healthRoutes);

  // ── API v1 Routes ─────────────────────────────────────────────────────────────
  await fastify.register(
    async (api: FastifyInstance) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(orgRoutes, { prefix: '' });
      await api.register(staffRoutes, { prefix: '/staff' });
      await api.register(membersRoutes, { prefix: '/members' });
      await api.register(membershipsRoutes, { prefix: '' });
      await api.register(attendanceRoutes, { prefix: '/attendance' });
      await api.register(paymentsRoutes, { prefix: '' });
      await api.register(notificationsRoutes, { prefix: '' });
      await api.register(searchRoutes, { prefix: '/search' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(trainersRoutes, { prefix: '/trainers' });
      await api.register(ptRoutes, { prefix: '/pt' });
      await api.register(leadsRoutes, { prefix: '/leads' });
      await api.register(workoutsRoutes, { prefix: '' });
      await api.register(reportsRoutes, { prefix: '/reports' });
      await api.register(adminRoutes, { prefix: '/admin' });
      await api.register(storageRoutes, { prefix: '/storage' });
    },
    { prefix: config.apiPrefix },
  );

  // ── Swagger finalize ──────────────────────────────────────────────────────────
  await fastify.ready();
  fastify.swagger();

  return fastify;
}
