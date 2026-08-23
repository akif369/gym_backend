import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, getPresignedUrl } from '../../common/storage/s3';
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

  /**
   * GET /storage/:bucket/*
   *
   * Legacy proxy route — kept for backwards compatibility with any existing
   * full-URL records in the database that still point to the backend.
   * New uploads store keys only and are served via presigned URLs.
   */
  fastify.get('/:bucket/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const { bucket } = request.params as { bucket: string };
    const key = (request.params as any)['*'];

    if (!bucket || !key) {
      return reply.status(400).send({ error: 'Bucket and key are required' });
    }

    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const data = await s3Client.send(command);

      if (data.ContentType) {
        reply.header('Content-Type', data.ContentType);
      }
      if (data.ContentLength) {
        reply.header('Content-Length', data.ContentLength);
      }

      // Fastify reply can accept a stream
      return reply.send(data.Body);
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.name === 'NotFound') {
        return reply.status(404).send({ error: 'Not Found' });
      }
      request.log.error({ err, bucket, key }, 'Failed to get object from storage');
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
