import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../common/auth/requireAuth';
import { requirePermission } from '../../common/auth/requirePermission';
import { trainersController } from './trainers.controller';

export async function trainersRoutes(fastify: FastifyInstance): Promise<void> {
  const authView = [requireAuth, requirePermission('trainer.view')];
  const authManage = [requireAuth, requirePermission('trainer.manage')];

  fastify.get('/me/dashboard', { preHandler: [requireAuth], schema: { tags: ['Trainers'], summary: 'My Trainer Dashboard' } }, trainersController.meDashboard);
  fastify.get('/', { preHandler: authView, schema: { tags: ['Trainers'], summary: 'List trainers' } }, trainersController.list);
  fastify.post('/', { preHandler: authManage, schema: { tags: ['Trainers'], summary: 'Create trainer' } }, trainersController.create);
  fastify.get('/:trainerId', { preHandler: authView, schema: { tags: ['Trainers'], summary: 'Trainer detail' } }, trainersController.getOne);
  fastify.patch('/:trainerId', { preHandler: authManage, schema: { tags: ['Trainers'], summary: 'Update trainer' } }, trainersController.update);
  fastify.patch('/:trainerId/status', { preHandler: authManage, schema: { tags: ['Trainers'], summary: 'Update trainer status' } }, trainersController.updateStatus);
  fastify.get('/:trainerId/members', { preHandler: authView, schema: { tags: ['Trainers'], summary: 'Members assigned to trainer' } }, trainersController.getMembers);
  fastify.post('/:trainerId/assign-members', { preHandler: authManage, schema: { tags: ['Trainers'], summary: 'Bulk assign members to trainer' } }, trainersController.assignMembers);
  fastify.delete('/:trainerId/members/:memberId', { preHandler: authManage, schema: { tags: ['Trainers'], summary: 'Remove trainer assignment' } }, trainersController.removeMember);
  fastify.get('/:trainerId/performance', { preHandler: authView, schema: { tags: ['Trainers'], summary: 'Trainer performance summary' } }, trainersController.performance);
}
