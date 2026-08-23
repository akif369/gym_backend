import type { FastifyInstance } from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import { config } from '../config/env';

export async function registerHelmet(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyHelmet, {
    // Relax CSP in dev (for Swagger UI)
    contentSecurityPolicy: config.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false, // required for Swagger UI
    crossOriginResourcePolicy: false, // allow images/resources to load from different origins
  });
}
