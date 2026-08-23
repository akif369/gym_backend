import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPresignedUrl } from '../../common/storage/s3';
import { requireAuth } from '../../common/auth/requireAuth';

// Presigned URL TTL in seconds (15 minutes)
const PRESIGNED_URL_TTL = 900;
// Maximum TTL a caller may request (1 hour)
const MAX_PRESIGNED_TTL = 3600;

export async function storageRoutes(fastify: FastifyInstance) {
  /**
   * GET /storage/sign?key=<s3-key>&expiresIn=<seconds>
   *
   * Returns a short-lived presigned GET URL for a private S3 object.
   * Requires authentication — only org members can sign URLs.
   *
   * This is the ONLY way images are served. The old backend-proxy route
   * /:bucket/* has been removed. All images must go directly from the
   * browser → S3 via a presigned URL.
   */
  fastify.get(
    '/sign',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Storage'],
        summary: 'Generate a presigned URL for a private S3 object',
        querystring: {
          type: 'object',
          required: ['key'],
          properties: {
            key: { type: 'string', minLength: 1 },
            expiresIn: { type: 'integer', minimum: 60, maximum: MAX_PRESIGNED_TTL },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { key, expiresIn } = request.query as { key: string; expiresIn?: number };

      const ttl = Math.min(expiresIn ?? PRESIGNED_URL_TTL, MAX_PRESIGNED_TTL);

      const url = await getPresignedUrl(key, ttl);
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

      return reply.send({ url, expiresAt, ttl });
    },
  );
}
