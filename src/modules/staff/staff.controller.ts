import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  listStaffService, createStaffService, getStaffService,
  updateStaffService, updateStaffStatusService, updateStaffPermissionsService,
  getRolesService, getAuditLogsService, inviteStaffService, resetStaffPasswordService,
  deleteStaffService
} from './staff.service';
import { SYSTEM_PERMISSIONS } from '../../db/schema/rbac.schema';

export const staffController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const query = { ...(request.query as Record<string, unknown>) };
    if (!['OWNER', 'ORGANIZATION_OWNER'].includes(request.user.role)) {
      query.branchId = request.user.branchId;
    }
    const result = await listStaffService(request.user.orgId, query);
    return reply.send(result);
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    const staff = await createStaffService(request.user.orgId, request.body as any, request.user.userId);
    return reply.status(201).send({ staff });
  },

  async getOne(request: FastifyRequest<{ Params: { staffId: string } }>, reply: FastifyReply) {
    const staff = await getStaffService(request.user.orgId, request.params.staffId);
    return reply.send({ staff });
  },

  async update(request: FastifyRequest<{ Params: { staffId: string } }>, reply: FastifyReply) {
    const staff = await updateStaffService(request.user.orgId, request.params.staffId, request.body as any, request.user.userId);
    return reply.send({ staff });
  },

  async updateStatus(request: FastifyRequest<{ Params: { staffId: string } }>, reply: FastifyReply) {
    const { status } = request.body as { status: 'ACTIVE' | 'INACTIVE' };
    const staff = await updateStaffStatusService(request.user.orgId, request.params.staffId, status, request.user.userId);
    return reply.send({ staff });
  },

  async updatePermissions(request: FastifyRequest<{ Params: { staffId: string } }>, reply: FastifyReply) {
    const { permissions } = request.body as { permissions: string[] };
    const result = await updateStaffPermissionsService(request.user.orgId, request.params.staffId, permissions, request.user.userId);
    return reply.send(result);
  },

  async getRoles(request: FastifyRequest, reply: FastifyReply) {
    const roleList = await getRolesService(request.user.orgId);
    return reply.send({ roles: roleList });
  },

  async getPermissions(_request: FastifyRequest, reply: FastifyReply) {
    return reply.send({ permissions: SYSTEM_PERMISSIONS });
  },

  async getAuditLogs(request: FastifyRequest, reply: FastifyReply) {
    const result = await getAuditLogsService(request.user.orgId, request.query as any);
    return reply.send(result);
  },

  async invite(request: FastifyRequest, reply: FastifyReply) {
    const result = await inviteStaffService(request.user.orgId, request.body as any, request.user.userId);
    return reply.status(201).send(result);
  },

  async resetPassword(request: FastifyRequest<{ Params: { staffId: string } }>, reply: FastifyReply) {
    const result = await resetStaffPasswordService(request.user.orgId, request.params.staffId, request.user.userId);
    return reply.send(result);
  },

  async delete(request: FastifyRequest<{ Params: { staffId: string } }>, reply: FastifyReply) {
    const result = await deleteStaffService(request.user.orgId, request.params.staffId, request.user.userId);
    return reply.send(result);
  },
};
