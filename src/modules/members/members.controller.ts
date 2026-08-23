import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  listMembersService, createMemberService, getMemberService,
  updateMemberService, updateMemberStatusService, deleteMemberService,
  getMemberActivityService, getMemberMeasurementsService, addMemberMeasurementService,
  getMemberHealthProfileService, updateMemberHealthProfileService,
  uploadMemberPhotoService, deleteMemberPhotoService,
} from './members.service';
import { isStrictPaymentPolicyEnabled } from '../org/org.service';

export const membersController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const result = await listMembersService(request.user.orgId, request.query as any);
    return reply.send({ ...result, strictPaymentPolicy: await isStrictPaymentPolicyEnabled(request.user.orgId) });
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    const member = await createMemberService(request.user.orgId, request.body as any, request.user.userId);
    return reply.status(201).send({ member });
  },

  async getOne(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const member = await getMemberService(request.user.orgId, request.params.memberId);
    return reply.send({ member });
  },

  async update(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const member = await updateMemberService(request.user.orgId, request.params.memberId, request.body as any, request.user.userId);
    return reply.send({ member });
  },

  async updateStatus(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const { status } = request.body as { status: string };
    const member = await updateMemberStatusService(request.user.orgId, request.params.memberId, status, request.user.userId);
    return reply.send({ member });
  },

  async delete(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const result = await deleteMemberService(request.user.orgId, request.params.memberId, request.user.userId);
    return reply.send(result);
  },

  async getActivity(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const activity = await getMemberActivityService(request.user.orgId, request.params.memberId);
    return reply.send({ activity });
  },

  async getMeasurements(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const measurements = await getMemberMeasurementsService(request.user.orgId, request.params.memberId);
    return reply.send({ measurements });
  },

  async addMeasurement(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const measurement = await addMemberMeasurementService(
      request.user.orgId, request.params.memberId, request.body as any, request.user.userId,
    );
    return reply.status(201).send({ measurement });
  },

  async getHealthProfile(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const health = await getMemberHealthProfileService(request.user.orgId, request.params.memberId);
    return reply.send({ health });
  },

  async updateHealthProfile(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const health = await updateMemberHealthProfileService(request.user.orgId, request.params.memberId, request.body as any, request.user.userId);
    return reply.send({ health });
  },

  async uploadPhoto(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const data = await request.file();
    if (!data) throw new Error('No file uploaded');
    const buffer = await data.toBuffer();
    const result = await uploadMemberPhotoService(
      request.user.orgId, request.params.memberId, buffer, data.filename, request.user.userId,
    );
    return reply.send(result);
  },

  async deletePhoto(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const result = await deleteMemberPhotoService(request.user.orgId, request.params.memberId, request.user.userId);
    return reply.send(result);
  },
};
