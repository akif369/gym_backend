import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  superAdminLogin,
  getAdminStats,
  listOrganizations,
  updateOrganizationStatus,
  updateOrganizationMode,
  getOrganizationBranches,
  resetOrganizationOwnerPassword,
  createOrganization,
  getGlobalAuditLogs,
  getOrganizationUsers,
  getOrganizationMembers,
  updateAdminUser,
  deleteAdminUser,
  deleteAdminMember,
  deleteAdminBranch,
  deleteAdminOrganization,
} from './admin.service';

export const adminController = {
  async login(req: FastifyRequest, reply: FastifyReply) {
    const result = await superAdminLogin(req.server, req.body);
    return reply.send(result);
  },

  async getStats(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await getAdminStats());
  },

  async getOrganizations(req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ organizations: await listOrganizations() });
  },

  async updateOrganizationStatus(req: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) {
    const status = (req.body as any).status;
    return reply.send({ organization: await updateOrganizationStatus(req.params.orgId, status) });
  },

  async updateOrganizationMode(req: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) {
    const { mode } = req.body as { mode: 'SINGLE_GYM' | 'MULTI_GYM' };
    if (!mode || !['SINGLE_GYM', 'MULTI_GYM'].includes(mode)) {
      return reply.status(400).send({ error: { message: 'mode must be SINGLE_GYM or MULTI_GYM' } });
    }
    return reply.send({ organization: await updateOrganizationMode(req.params.orgId, mode) });
  },

  async getBranches(req: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) {
    return reply.send({ branches: await getOrganizationBranches(req.params.orgId) });
  },

  async resetOwnerPassword(req: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) {
    const newPassword = (req.body as any).newPassword;
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    return reply.send(await resetOrganizationOwnerPassword(req.params.orgId, newPassword));
  },

  async createOrg(req: FastifyRequest, reply: FastifyReply) {
    const payload = req.body as any;
    if (!payload.orgName || !payload.orgEmail || !payload.ownerEmail || !payload.ownerPassword) {
      throw new Error('Missing required fields for organization creation');
    }
    const result = await createOrganization(payload);
    return reply.send({ message: 'Organization created successfully', ...result });
  },

  async getAuditLogs(req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ logs: await getGlobalAuditLogs() });
  },

  async getUsers(req: FastifyRequest<{ Params: { orgId: string }; Querystring: { page?: number; limit?: number } }>, reply: FastifyReply) {
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;
    return reply.send(await getOrganizationUsers(req.params.orgId, page, limit));
  },

  async getMembers(req: FastifyRequest<{ Params: { orgId: string }; Querystring: { page?: number; limit?: number } }>, reply: FastifyReply) {
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;
    return reply.send(await getOrganizationMembers(req.params.orgId, page, limit));
  },

  async updateUser(req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
    return reply.send({ user: await updateAdminUser(req.params.userId, req.body as any) });
  },

  async deleteUser(req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
    return reply.send(await deleteAdminUser(req.params.userId));
  },

  async deleteMember(req: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    return reply.send(await deleteAdminMember(req.params.memberId));
  },

  async deleteBranch(req: FastifyRequest<{ Params: { branchId: string } }>, reply: FastifyReply) {
    return reply.send(await deleteAdminBranch(req.params.branchId));
  },

  async deleteOrganization(req: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) {
    return reply.send(await deleteAdminOrganization(req.params.orgId));
  },
};
