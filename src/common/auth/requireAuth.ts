import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError, ErrorCode } from '../errors/AppError';
import { db } from '../../db/index';
import { users, userSessions, organizations, branches } from '../../db/schema/index';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { DEFAULT_ROLE_PERMISSIONS } from '../../db/schema/rbac.schema';

// ── JWT Payload Type ──────────────────────────────────────────────────────────

export interface JwtAccessPayload {
  userId: string;
  email: string;
  role: string;
  type?: string;
  orgId: string;
  branchId?: string | null;
  sessionId: string;
}

// Augmentation moved to fastify.d.ts

// ── requireAuth Prehandler ────────────────────────────────────────────────────

export const requireAuth = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  try {
    // Verifies the JWT signature and decodes the payload
    const decoded = await request.jwtVerify<JwtAccessPayload>();

    // ── Super Admin Bypass ───────────────────────────────────────────────────
    if (decoded.role === 'SUPER_ADMIN') {
      const activeBranchId = (request.headers['x-branch-id'] as string) || decoded.branchId || null;
      request.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        orgId: decoded.orgId,
        organizationId: decoded.orgId, // TenantContext
        branchId: decoded.branchId,
        activeBranchId: activeBranchId || null,
        accessibleBranchIds: activeBranchId ? [activeBranchId] : [], // Bypass for SA
        organizationMode: 'MULTI_GYM',
        sessionId: decoded.sessionId,
        permissions: ['*'], // Super Admin has implicit global permissions
      };
      return;
    }

    // Validate the session still exists and is not revoked
    const [session] = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.id, decoded.sessionId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      throw AppError.unauthorized(ErrorCode.SESSION_REVOKED, 'Session has been revoked or expired');
    }

    // Fetch user status
    const [user] = await db
      .select({
        id: users.id,
        status: users.status,
        role: users.role,
        organizationId: users.organizationId,
        branchId: users.branchId,
        organizationMode: organizations.organizationMode,
      })
      .from(users)
      .leftJoin(organizations, eq(users.organizationId, organizations.id))
      .where(and(eq(users.id, decoded.userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      throw AppError.unauthorized(ErrorCode.UNAUTHORIZED, 'User not found');
    }

    if (user.status === 'INACTIVE') {
      throw AppError.unauthorized(ErrorCode.ACCOUNT_INACTIVE, 'Account is deactivated');
    }

    // Resolve permissions (role defaults for now — per-user overrides checked separately)
    const permissions = DEFAULT_ROLE_PERMISSIONS[user.role] ?? [];

    // Fetch accessible branches
    const orgBranches = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.organizationId, user.organizationId));
    
    let accessibleBranchIds: string[] = [];
    if (user.role === 'ORGANIZATION_OWNER' || user.role === 'OWNER') {
      accessibleBranchIds = orgBranches.map((b) => b.id);
    } else if (user.branchId) {
      // Staff/managers restricted to their assigned branch for now
      accessibleBranchIds = [user.branchId];
    }

    // Determine active branch from header, fallback to token's branchId
    let requestedBranchId = request.headers['x-branch-id'] as string | undefined;
    let activeBranchId: string | null = requestedBranchId || user.branchId || null;

    // Validate active branch against accessible branches
    if (activeBranchId && !accessibleBranchIds.includes(activeBranchId)) {
      // If requested branch is invalid, fallback to the first available or null
      activeBranchId = accessibleBranchIds.length > 0 ? accessibleBranchIds[0] ?? null : null;
    }

    // Attach to request
    request.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: user.role,
      orgId: user.organizationId,
      organizationId: user.organizationId,
      branchId: user.branchId,
      activeBranchId: activeBranchId ?? null,
      accessibleBranchIds,
      organizationMode: user.organizationMode ?? 'SINGLE_GYM',
      sessionId: decoded.sessionId,
      permissions,
    };
  } catch (err) {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, requestId: request.id },
      });
      return;
    }
    // JWT verification error
    reply.status(401).send({
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid or expired access token',
        requestId: request.id,
      },
    });
  }
};

// ── optionalAuth — Attaches user if token present, does not reject ────────────

export const optionalAuth = async (
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return;

  try {
    await requireAuth(request, _reply);
  } catch {
    // silently ignore
  }
};
