import {
  listTrainersService, createTrainerService, getTrainerService, updateTrainerService,
  updateTrainerStatusService, getTrainerMembersService, assignMembersService,
  removeTrainerMemberService, getTrainerPerformanceService, getTrainerDashboardService
} from './trainers.service';

export const trainersController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await listTrainersService(req.user.orgId, req.query as any));
  },
  async create(req: FastifyRequest, reply: FastifyReply) {
    return reply.status(201).send({ trainer: await createTrainerService(req.user.orgId, req.body) });
  },
  async getOne(req: FastifyRequest<{ Params: { trainerId: string } }>, reply: FastifyReply) {
    return reply.send({ trainer: await getTrainerService(req.user.orgId, req.params.trainerId) });
  },
  async update(req: FastifyRequest<{ Params: { trainerId: string } }>, reply: FastifyReply) {
    return reply.send({ trainer: await updateTrainerService(req.user.orgId, req.params.trainerId, req.body) });
  },
  async updateStatus(req: FastifyRequest<{ Params: { trainerId: string } }>, reply: FastifyReply) {
    const { status } = req.body as any;
    return reply.send({ trainer: await updateTrainerStatusService(req.user.orgId, req.params.trainerId, status) });
  },
  async getMembers(req: FastifyRequest<{ Params: { trainerId: string } }>, reply: FastifyReply) {
    return reply.send({ members: await getTrainerMembersService(req.user.orgId, req.params.trainerId) });
  },
  async assignMembers(req: FastifyRequest<{ Params: { trainerId: string } }>, reply: FastifyReply) {
    const { memberIds } = req.body as any;
    return reply.send({ assigned: await assignMembersService(req.user.orgId, req.params.trainerId, memberIds, req.user.userId) });
  },
  async removeMember(req: FastifyRequest<{ Params: { trainerId: string; memberId: string } }>, reply: FastifyReply) {
    await removeTrainerMemberService(req.user.orgId, req.params.trainerId, req.params.memberId, req.user.userId);
    return reply.send({ message: 'Assignment removed' });
  },
  async performance(req: FastifyRequest<{ Params: { trainerId: string } }>, reply: FastifyReply) {
    return reply.send(await getTrainerPerformanceService(req.user.orgId, req.params.trainerId));
  },
  async meDashboard(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await getTrainerDashboardService(req.user.orgId, req.user.userId));
  },
};
