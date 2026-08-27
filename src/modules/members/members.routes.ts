import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../common/auth/requireAuth';
import { requirePermission } from '../../common/auth/requirePermission';
import { membersController } from './members.controller';

export async function membersRoutes(fastify: FastifyInstance): Promise<void> {
  const authAndView = [requireAuth, requirePermission('member.view')];
  const authAndCreate = [requireAuth, requirePermission('member.create')];
  const authAndUpdate = [requireAuth, requirePermission('member.update')];

  fastify.get('/me/membership-status', { preHandler: [requireAuth], schema: { tags: ['Members'], summary: 'Get my membership status' } }, membersController.getMyMembershipStatus);
  
  fastify.get('/', { preHandler: authAndView, schema: { tags: ['Members'], summary: 'List members (paginated, filterable)' } }, membersController.list);
  fastify.post('/', { preHandler: authAndCreate, schema: { tags: ['Members'], summary: 'Create member' } }, membersController.create);
  fastify.get('/:memberId', { preHandler: authAndView, schema: { tags: ['Members'], summary: 'Get member detail' } }, membersController.getOne);
  fastify.patch('/:memberId', { preHandler: authAndUpdate, schema: { tags: ['Members'], summary: 'Update member profile' } }, membersController.update);
  fastify.patch('/:memberId/status', { preHandler: authAndUpdate, schema: { tags: ['Members'], summary: 'Change member status' } }, membersController.updateStatus);
  fastify.delete('/:memberId', { preHandler: authAndUpdate, schema: { tags: ['Members'], summary: 'Delete member' } }, membersController.delete);
  fastify.get('/:memberId/activity', { preHandler: authAndView, schema: { tags: ['Members'], summary: 'Member activity timeline' } }, membersController.getActivity);
  fastify.get('/:memberId/measurements', { preHandler: authAndView, schema: { tags: ['Members'], summary: 'Member measurement history' } }, membersController.getMeasurements);
  fastify.post('/:memberId/measurements', { preHandler: authAndCreate, schema: { tags: ['Members'], summary: 'Add body measurement' } }, membersController.addMeasurement);
  fastify.get('/:memberId/health-profile', { preHandler: authAndView, schema: { tags: ['Members'], summary: 'Get health profile' } }, membersController.getHealthProfile);
  fastify.patch('/:memberId/health-profile', { preHandler: authAndUpdate, schema: { tags: ['Members'], summary: 'Update health profile' } }, membersController.updateHealthProfile);
  fastify.post('/:memberId/photo', { preHandler: authAndUpdate, schema: { tags: ['Members'], summary: 'Upload member photo', consumes: ['multipart/form-data'] } }, membersController.uploadPhoto);
  fastify.delete('/:memberId/photo', { preHandler: authAndUpdate, schema: { tags: ['Members'], summary: 'Delete member photo' } }, membersController.deletePhoto);
  fastify.get('/:memberId/access-status', { preHandler: authAndView, schema: { tags: ['Members'], summary: 'Get current access status' } }, membersController.getAccessStatus);
}
