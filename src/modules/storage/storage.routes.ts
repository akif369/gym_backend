import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../../common/storage/s3';

export async function storageRoutes(fastify: FastifyInstance) {
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
