import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../common/auth/requireAuth';
import { adminController } from './admin.controller';
import { AppError, ErrorCode } from '../../common/errors/AppError';

// Middleware specific to Super Admin
async function requireSuperAdmin(req: any) {
  if (req.user?.role !== 'SUPER_ADMIN') {
    throw AppError.forbidden(ErrorCode.FORBIDDEN, 'Super Admin access required');
  }
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const adminAuth = [requireAuth, requireSuperAdmin];

  fastify.post(
    '/login',
    { schema: { tags: ['Admin'], summary: 'Super admin login' } },
    adminController.login as any
  );

  fastify.get(
    '/stats',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Get global stats' } },
    adminController.getStats as any
  );

  fastify.get(
    '/organizations',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'List all organizations' } },
    adminController.getOrganizations as any
  );

  fastify.patch(
    '/organizations/:orgId/status',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Update organization status' } },
    adminController.updateOrganizationStatus as any
  );

  fastify.patch(
    '/organizations/:orgId/mode',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Change organization mode (SINGLE_GYM / MULTI_GYM)' } },
    adminController.updateOrganizationMode as any
  );

  fastify.get(
    '/organizations/:orgId/branches',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'List branches for organization' } },
    adminController.getBranches as any
  );

  fastify.post(
    '/organizations/:orgId/reset-password',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Reset owner password for organization' } },
    adminController.resetOwnerPassword as any
  );

  fastify.post(
    '/organizations',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Create a new organization (Tenant Onboarding)' } },
    adminController.createOrg as any
  );

  fastify.get(
    '/organizations/:orgId/users',
    {
      preHandler: adminAuth,
      schema: {
        tags: ['Admin'],
        summary: 'List platform users for an organization'
      },
    },
    adminController.getUsers as any
  );

  fastify.get(
    '/organizations/:orgId/members',
    {
      preHandler: adminAuth,
      schema: {
        tags: ['Admin'],
        summary: 'List members for an organization'
      },
    },
    adminController.getMembers as any
  );

  fastify.patch(
    '/users/:userId',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Update a user' } },
    adminController.updateUser as any
  );

  fastify.delete(
    '/users/:userId',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Permanently delete a user' } },
    adminController.deleteUser as any
  );

  fastify.delete(
    '/members/:memberId',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Permanently delete a member' } },
    adminController.deleteMember as any
  );

  fastify.delete(
    '/branches/:branchId',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Permanently delete a branch' } },
    adminController.deleteBranch as any
  );

  fastify.delete(
    '/organizations/:orgId',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'Permanently delete an organization' } },
    adminController.deleteOrganization as any
  );

  fastify.get(
    '/audit-logs',
    { preHandler: adminAuth, schema: { tags: ['Admin'], summary: 'View global staff audit logs' } },
    adminController.getAuditLogs as any
  );
}
