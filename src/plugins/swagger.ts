import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { config } from '../config/env';

export async function registerSwagger(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'GYMatrix API',
        description: 'Production-grade Gym Management SaaS REST API',
        version: '1.0.0',
        contact: {
          name: 'GYMatrix Support',
          email: 'support@gymatrix.app',
        },
      },
      servers: [
        {
          url: `http://localhost:${config.port}${config.apiPrefix}`,
          description: 'Local development server',
        },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Access token obtained from POST /auth/login',
          },
        },
        schemas: {
          PaginatedResponse: {
            type: 'object',
            properties: {
              items: { type: 'array', items: {} },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' },
              hasNext: { type: 'boolean' },
              hasPrev: { type: 'boolean' },
            },
          },
          ErrorResponse: {
            type: 'object',
            required: ['error'],
            properties: {
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  requestId: { type: 'string' },
                  details: { type: 'array', items: {} },
                },
              },
            },
          },
        },
      },
      security: [{ BearerAuth: [] }],
      tags: [
        { name: 'Health', description: 'Liveness and readiness endpoints' },
        { name: 'Auth', description: 'Authentication and session management' },
        { name: 'Org', description: 'Organization and branch management' },
        { name: 'Settings', description: 'System settings' },
        { name: 'Staff', description: 'Staff management and RBAC' },
        { name: 'Members', description: 'Member CRUD and profiles' },
        { name: 'Memberships', description: 'Membership plans and lifecycle' },
        { name: 'Attendance', description: 'Check-in/out and analytics' },
        { name: 'Payments', description: 'Payments, invoices, and refunds' },
        { name: 'Trainers', description: 'Trainer management and assignments' },
        { name: 'PT', description: 'Personal training packages and sessions' },
        { name: 'Leads', description: 'CRM pipeline and lead conversion' },
        { name: 'Workouts', description: 'Exercise library and workout templates' },
        { name: 'Reports', description: 'Analytics reports and CSV/PDF exports' },
      ],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: true,
    },
    staticCSP: false,
    transformStaticCSP: (header: string) => header,
  });
}
