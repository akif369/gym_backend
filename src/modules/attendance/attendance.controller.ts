import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  checkInService, checkOutService, getCurrentlyInsideService,
  listAttendanceService, getMemberAttendanceService, correctAttendanceService,
  getPeakHoursService, getDailyAttendanceService,
} from './attendance.service';

export const attendanceController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const result = await listAttendanceService(request.user, request.query as any);
    return reply.send(result);
  },
  async currentlyInside(request: FastifyRequest, reply: FastifyReply) {
    const members = await getCurrentlyInsideService(request.user);
    return reply.send({ members, count: members.length });
  },
  async checkIn(request: FastifyRequest, reply: FastifyReply) {
    const log = await checkInService(
      request.user,
      request.body as any
    );
    return reply.status(201).send({ log });
  },
  async checkInQr(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as any;
    const log = await checkInService(
      request.user,
      { ...body, method: 'QR' }
    );
    return reply.status(201).send({ log });
  },
  async checkInRfid(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as any;
    const log = await checkInService(
      request.user,
      { ...body, method: 'RFID' }
    );
    return reply.status(201).send({ log });
  },
  async checkOut(request: FastifyRequest, reply: FastifyReply) {
    const log = await checkOutService(request.user, request.body as any);
    return reply.send({ log });
  },
  async correct(request: FastifyRequest, reply: FastifyReply) {
    const log = await correctAttendanceService(request.user, request.body as any);
    return reply.send({ log });
  },
  async memberHistory(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    const result = await getMemberAttendanceService(request.user, request.params.memberId, request.query as any);
    return reply.send(result);
  },
  async peakHours(request: FastifyRequest, reply: FastifyReply) {
    const data = await getPeakHoursService(request.user);
    return reply.send({ peakHours: data });
  },
  async daily(request: FastifyRequest, reply: FastifyReply) {
    const days = parseInt((request.query as any)['days'] ?? '30', 10);
    const data = await getDailyAttendanceService(request.user, days);
    return reply.send({ daily: data });
  },
};
