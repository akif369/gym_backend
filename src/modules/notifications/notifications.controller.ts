import { randomUUID } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { sendTextMessage } from './notifications.service';

export const notificationsController = {
  async sendText(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { number?: unknown; text?: unknown };
    if (typeof body.number !== 'string' || typeof body.text !== 'string' || !body.number.trim() || !body.text.trim()) {
      throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'number and text are required');
    }
    if (body.text.length > 4096) {
      throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Text messages are limited to 4096 characters');
    }

    const requestKey = request.headers['idempotency-key'];
    const delivery = await sendTextMessage({
      ctx: request.user,
      eventType: 'MANUAL',
      phone: body.number,
      text: body.text.trim(),
      idempotencyKey: `manual:${request.user.userId}:${typeof requestKey === 'string' ? requestKey : randomUUID()}`,
      actorId: request.user.userId,
    });
    return reply.status(202).send({ delivery });
  },
};
