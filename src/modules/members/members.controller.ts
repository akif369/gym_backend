import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  listMembersService, createMemberService, getMemberService,
  updateMemberService, updateMemberStatusService, deleteMemberService,
  getMemberActivityService, getMemberMeasurementsService, addMemberMeasurementService,
  getMemberHealthProfileService, updateMemberHealthProfileService,
  uploadMemberPhotoService, deleteMemberPhotoService,
  getMemberAccessStatusService,
  getMemberDeletionSummaryService, hardDeleteMemberService,
} from './members.service';
import { db } from '../../db/index';
import { membershipPlans } from '../../db/schema/memberships.schema';
import { members } from '../../db/schema/members.schema';
import { users } from '../../db/schema/auth.schema';
import { eq, and } from 'drizzle-orm';
import { AppError } from '../../common/errors/AppError';
import { isStrictPaymentPolicyEnabled } from '../org/org.service';

export const membersController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const query = { ...(request.query as Record<string, unknown>) };
    if (!['OWNER', 'ORGANIZATION_OWNER'].includes(request.user.role)) {
      query.branchId = request.user.branchId;
    }
    const result = await listMembersService(request.user, query);
    return reply.send({ ...result, strictPaymentPolicy: await isStrictPaymentPolicyEnabled(request.user.organizationId) });
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = request.body as any;
    if (!['OWNER', 'ORGANIZATION_OWNER'].includes(request.user.role)) {
      data.branchId = request.user.branchId;
    }
    const member = await createMemberService(request.user, data);
    return reply.status(201).send({ member });
  },

  async getOne(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const member = await getMemberService(request.user, request.params.memberId);
    return reply.send({ member });
  },

  async update(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const member = await updateMemberService(request.user, request.params.memberId, request.body as any);
    return reply.send({ member });
  },

  async updateStatus(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const { status } = request.body as { status: string };
    const member = await updateMemberStatusService(request.user, request.params.memberId, status);
    return reply.send({ member });
  },

  async delete(request: FastifyRequest<{ Params: { memberId: string }, Body: { deletionReason?: string } }>, reply: FastifyReply) {
    const { deletionReason } = request.body || {};
    const result = await deleteMemberService(request.user, request.params.memberId, deletionReason);
    return reply.send(result);
  },

  async hardDelete(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const result = await hardDeleteMemberService(request.user, request.params.memberId);
    return reply.send(result);
  },

  async getDeletionSummary(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const summary = await getMemberDeletionSummaryService(request.user, request.params.memberId);
    return reply.send(summary);
  },

  async getActivity(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const activity = await getMemberActivityService(request.user, request.params.memberId);
    return reply.send({ activity });
  },

  async getMeasurements(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const measurements = await getMemberMeasurementsService(request.user, request.params.memberId);
    return reply.send({ measurements });
  },

  async addMeasurement(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const measurement = await addMemberMeasurementService(request.user, request.params.memberId, request.body as any);
    return reply.status(201).send({ measurement });
  },

  async getHealthProfile(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const profile = await getMemberHealthProfileService(request.user, request.params.memberId);
    return reply.send({ profile });
  },

  async updateHealthProfile(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const profile = await updateMemberHealthProfileService(request.user, request.params.memberId, request.body as any);
    return reply.send({ profile });
  },

  async uploadPhoto(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const data = await request.file();
    if (!data) throw AppError.badRequest('BAD_REQUEST', 'No file uploaded');
    const buffer = await data.toBuffer();
    const result = await uploadMemberPhotoService(request.user, request.params.memberId, buffer, data.filename);
    return reply.send(result);
  },

  async deletePhoto(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const result = await deleteMemberPhotoService(request.user, request.params.memberId);
    return reply.send(result);
  },

  async getAccessStatus(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const status = await getMemberAccessStatusService(request.user, request.params.memberId);
    return reply.send(status);
  },
  
  async getMyMembershipStatus(request: FastifyRequest, reply: FastifyReply) {
    const [user] = await db.select({ memberId: users.memberId }).from(users).where(eq(users.id, request.user.userId));
    if (!user?.memberId) throw AppError.notFound('MEMBER_NOT_FOUND', 'User does not have a member profile');
    const status = await getMemberAccessStatusService(request.user, user.memberId);
    return reply.send(status);
  }
};
