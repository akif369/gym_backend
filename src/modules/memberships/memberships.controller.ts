import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  listPlansService, createPlanService, getPlanService, updatePlanService, updatePlanStatusService, deletePlanService,
  getMemberMembershipsService, getMembershipEventsService, listMembershipEventsService,
  createMembershipService, activateMembershipService, renewMembershipService,
  freezeMembershipService, resumeMembershipService, cancelMembershipService, extendMembershipService,
} from './memberships.service';

export const membershipsController = {
  async listPlans(request: FastifyRequest, reply: FastifyReply) {
    const plans = await listPlansService(request.user);
    return reply.send({ plans });
  },
  async createPlan(request: FastifyRequest, reply: FastifyReply) {
    const plan = await createPlanService(request.user, request.body as any);
    return reply.status(201).send({ plan });
  },
  async getPlan(request: FastifyRequest<{ Params: { planId: string } }>, reply: FastifyReply) {
    const plan = await getPlanService(request.user, request.params.planId);
    return reply.send({ plan });
  },
  async updatePlan(request: FastifyRequest<{ Params: { planId: string } }>, reply: FastifyReply) {
    const plan = await updatePlanService(request.user, request.params.planId, request.body as any);
    return reply.send({ plan });
  },
  async updatePlanStatus(request: FastifyRequest<{ Params: { planId: string } }>, reply: FastifyReply) {
    const { status } = request.body as { status: 'ACTIVE' | 'INACTIVE' };
    const plan = await updatePlanStatusService(request.user, request.params.planId, status);
    return reply.send({ plan });
  },
  async deletePlan(request: FastifyRequest<{ Params: { planId: string } }>, reply: FastifyReply) {
    await deletePlanService(request.user, request.params.planId);
    return reply.status(204).send();
  },
  async getMemberMemberships(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const memberships = await getMemberMembershipsService(request.user, request.params.memberId);
    return reply.send({ memberships });
  },
  async getMembershipEvents(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const events = await getMembershipEventsService(request.user, request.params.memberId);
    return reply.send({ events });
  },
  async listEvents(request: FastifyRequest, reply: FastifyReply) {
    const result = await listMembershipEventsService(request.user, request.query as any);
    return reply.send(result);
  },
  async createMembership(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const membership = await createMembershipService(
      request.user, request.params.memberId,
      { ...(request.body as any), idempotencyKey },
    );
    return reply.status(201).send({ membership });
  },
  async activateMembership(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const membership = await activateMembershipService(request.user, request.params.memberId);
    return reply.send({ membership });
  },
  async renewMembership(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const membership = await renewMembershipService(request.user, request.params.memberId, { ...(request.body as any), idempotencyKey });
    return reply.send({ membership });
  },
  async freezeMembership(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const membership = await freezeMembershipService(request.user, request.params.memberId, request.body as any);
    return reply.send({ membership });
  },
  async resumeMembership(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const membership = await resumeMembershipService(request.user, request.params.memberId);
    return reply.send({ membership });
  },
  async cancelMembership(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const { reason } = request.body as { reason: string };
    const membership = await cancelMembershipService(request.user, request.params.memberId, reason);
    return reply.send({ membership });
  },
  async extendMembership(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const { days, reason } = request.body as { days: number; reason: string };
    const membership = await extendMembershipService(request.user, request.params.memberId, days, reason);
    return reply.send({ membership });
  },
};
