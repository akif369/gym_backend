/**
 * Global Fastify type augmentations for GYMatrix
 */

import 'fastify';
import '@fastify/jwt';
import { TenantContext } from '../common/auth/tenant';

export interface JwtAccessPayload {
  userId: string;
  email: string;
  role: string | 'SUPER_ADMIN';
  type?: string;
  orgId: string;
  branchId?: string | null;
  sessionId: string;
}

export interface AuthUser extends JwtAccessPayload, TenantContext {
  permissions: string[];
  sessionId: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtAccessPayload; // payload type is used for sign and verify
    user: AuthUser; // user type is return type of `request.user` object
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}
