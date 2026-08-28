import type { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '../../db/index';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/test',
    {
      schema: {
        tags: ['Health'],
        summary: 'Test welcome endpoint',
        description: 'Returns a simple welcome message for quick backend smoke testing.',
        security: [],
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.send({
        message: 'Welcome to GYMatrix',
      });
    },
  );

  fastify.get(
    '/health/live',
    {
      schema: {
        tags: ['Health'],
        summary: 'Liveness probe',
        description: 'Returns 200 if the process is running. No dependency checks.',
        security: [],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptime: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
  );

  fastify.get(
    '/health/ready',
    {
      schema: {
        tags: ['Health'],
        summary: 'Readiness probe',
        description: 'Returns 200 if DB is reachable and server can accept traffic.',
        security: [],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              database: { type: 'string' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              database: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const dbOk = await checkDatabaseConnection();
      const status = dbOk ? 'ok' : 'degraded';
      const statusCode = dbOk ? 200 : 503;

      return reply.status(statusCode).send({
        status,
        timestamp: new Date().toISOString(),
        database: dbOk ? 'connected' : 'unreachable',
      });
    },
  );

  fastify.get(
    '/health/info',
    {
      schema: {
        tags: ['Health'],
        summary: 'App version info',
        security: [],
        response: {
          200: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              version: { type: 'string' },
              env: { type: 'string' },
              nodeVersion: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('../../../package.json') as { name: string; version: string };
      return reply.send({
        name: pkg.name,
        version: pkg.version,
        env: process.env['NODE_ENV'] ?? 'development',
        nodeVersion: process.version,
      });
    },
  );
}
