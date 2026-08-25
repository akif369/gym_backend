import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../common/auth/requireAuth';
import { requirePermission } from '../../common/auth/requirePermission';
import { orgController } from './org.controller';

export async function orgRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Organization ──────────────────────────────────────────────────────────
  fastify.get('/org', {
    preHandler: [requireAuth],
    schema: { tags: ['Org'], summary: 'Get organization profile' },
  }, orgController.getOrg);

  fastify.patch('/org', {
    preHandler: [requireAuth, requirePermission('org.manage')],
    schema: { tags: ['Org'], summary: 'Update organization profile' },
  }, orgController.updateOrg);

  // ── Branches ──────────────────────────────────────────────────────────────
  fastify.get('/branches', {
    preHandler: [requireAuth],
    schema: { tags: ['Org'], summary: 'List all branches' },
  }, orgController.listBranches);

  fastify.post('/branches', {
    preHandler: [requireAuth, requirePermission('org.manage')],
    schema: { tags: ['Org'], summary: 'Create a new branch' },
  }, orgController.createBranch);

  fastify.get('/branches/:branchId', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Org'],
      summary: 'Get branch detail',
      params: {
        type: 'object',
        properties: { branchId: { type: 'string', format: 'uuid' } },
      },
    },
  }, orgController.getBranch);

  fastify.patch('/branches/:branchId', {
    preHandler: [requireAuth, requirePermission('org.manage')],
    schema: {
      tags: ['Org'],
      summary: 'Update branch',
      params: {
        type: 'object',
        properties: { branchId: { type: 'string', format: 'uuid' } },
      },
    },
  }, orgController.updateBranch);

  // ── Settings ──────────────────────────────────────────────────────────────
  fastify.get('/settings', {
    preHandler: [requireAuth, requirePermission('settings.view')],
    schema: { tags: ['Settings'], summary: 'Get all settings' },
  }, orgController.getSettings);

  const settingsCategories = [
    'gym-profile', 'branch', 'attendance', 'tax', 'invoice', 'hardware', 'payment-policy', 'member', 'biometrics'
  ];

  for (const category of settingsCategories) {
    fastify.patch(`/settings/${category}`, {
      preHandler: [requireAuth, requirePermission('settings.manage')],
      schema: { tags: ['Settings'], summary: `Update ${category} settings` },
    }, await orgController.updateSettingsCategory(category));
  }
}
