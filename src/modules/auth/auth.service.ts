import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as jwtLib from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { addMinutes, addDays } from 'date-fns';
import { db } from '../../db/index';
import {
  users,
  userSessions,
  passwordResetTokens,
  organizations,
  branches,
  getPortalType,
  staffInviteTokens,
  type UserRoleType,
} from '../../db/schema/index';
import { roles, userPermissions, DEFAULT_ROLE_PERMISSIONS } from '../../db/schema/rbac.schema';
import { eq, and, isNull, gt, lt, inArray } from 'drizzle-orm';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { config } from '../../config/env';
import { createLogger } from '../../common/logger/index';
import { auditLog } from '../../common/audit/auditLog';
import { AuditAction } from '../../db/schema/audit.schema';
import type { FastifyInstance } from 'fastify';

const log = createLogger('auth-service');

// ── Token Helpers ─────────────────────────────────────────────────────────────

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function hashToken(token: string): Promise<string> {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Login ─────────────────────────────────────────────────────────────────────

export async function loginService(
  fastify: FastifyInstance,
  email: string,
  password: string,
  meta: { ipAddress?: string; userAgent?: string },
) {
  log.info({ email }, 'Login attempt');

  // Find user
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    log.warn({ email, ipAddress: meta.ipAddress, action: 'LOGIN_FAILED' }, 'Failed login attempt for unknown user');
    throw AppError.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
  }

  // Check account lock
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw AppError.unauthorized(
      ErrorCode.ACCOUNT_LOCKED,
      `Account is locked. Try again in ${minutesLeft} minutes.`,
    );
  }

  // Check if organization is suspended
  const [org] = await db
    .select({ 
      status: organizations.status,
      organizationMode: organizations.organizationMode
    })
    .from(organizations)
    .where(eq(organizations.id, user.organizationId))
    .limit(1);

  if (org && org.status === 'SUSPENDED') {
    throw AppError.unauthorized(
      ErrorCode.ACCOUNT_INACTIVE,
      'Your organization account has been suspended. Please contact support.'
    );
  }

  if (user.status === 'INACTIVE') {
    throw AppError.unauthorized(ErrorCode.ACCOUNT_INACTIVE, 'Your account has been deactivated');
  }

  // Verify password
  const passwordValid = await argon2.verify(user.passwordHash, password);

  if (!passwordValid) {
    // Increment failed login count
    const newCount = user.failedLoginCount + 1;
    const locked = newCount >= config.maxFailedLoginAttempts;

    await db
      .update(users)
      .set({
        failedLoginCount: newCount,
        lockedUntil: locked
          ? addMinutes(new Date(), config.accountLockoutDurationMinutes)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await auditLog({
      organizationId: user.organizationId,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: AuditAction.LOGIN_FAILED,
      entityType: 'auth',
      description: `Failed login attempt ${newCount}/${config.maxFailedLoginAttempts}`,
      ipAddress: meta.ipAddress,
    });

    if (locked) {
      throw AppError.unauthorized(
        ErrorCode.ACCOUNT_LOCKED,
        `Account locked after ${config.maxFailedLoginAttempts} failed attempts. Try again in ${config.accountLockoutDurationMinutes} minutes.`,
      );
    }

    throw AppError.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
  }

  // Reset failed login count
  await db
    .update(users)
    .set({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: meta.ipAddress ?? null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Create session
  const sessionId = uuidv4();
  const refreshToken = generateSecureToken();
  const refreshTokenHash = await hashToken(refreshToken);

  await db.insert(userSessions).values({
    id: sessionId,
    userId: user.id,
    refreshTokenHash,
    deviceInfo: meta.userAgent,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    expiresAt: addDays(new Date(), 365), // 1 year — sliding window reset on every refresh
    lastUsedAt: new Date(),
  });

  // Sign access token
  const accessToken = fastify.jwt.sign({
    userId: user.id,
    email: user.email,
    role: user.role,
    orgId: user.organizationId,
    branchId: user.branchId,
    sessionId,
  });

  // Resolve permissions
  const permissions = DEFAULT_ROLE_PERMISSIONS[user.role] ?? [];

  await auditLog({
    organizationId: user.organizationId,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: AuditAction.LOGIN_SUCCESS,
    entityType: 'auth',
    entityId: sessionId,
    description: 'Successful login',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  log.info({ userId: user.id, sessionId }, 'Login successful');

  let portalType = getPortalType(user.role as UserRoleType);
  if (org?.organizationMode === 'SINGLE_GYM' && portalType === 'org-owner') {
    portalType = 'branch';
  }

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      orgId: user.organizationId,
      branchId: user.branchId,
      memberId: user.memberId ?? null,
      permissions,
      portalType,
    },
  };
}

// ── Refresh Token ─────────────────────────────────────────────────────────────

export async function refreshTokenService(
  fastify: FastifyInstance,
  refreshToken: string,
  meta: { ipAddress?: string; userAgent?: string },
) {
  // Decode (don't use jwtVerify — we use a different secret)
  let decoded: { userId: string; sessionId: string };
  try {
    decoded = jwtLib.verify(refreshToken, config.jwt.refreshSecret, {
      algorithms: ['HS256'],
    }) as { userId: string; sessionId: string };
  } catch {
    throw AppError.unauthorized(ErrorCode.TOKEN_INVALID, 'Invalid refresh token');
  }

  const tokenHash = await hashToken(refreshToken);

  // Find and validate session
  const [session] = await db
    .select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.id, decoded.sessionId),
        eq(userSessions.refreshTokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    throw AppError.unauthorized(ErrorCode.SESSION_REVOKED, 'Session is invalid or expired');
  }

  // Fetch user
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, decoded.userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user || user.status === 'INACTIVE') {
    throw AppError.unauthorized(ErrorCode.UNAUTHORIZED, 'User account unavailable');
  }

  // Rotate refresh token (revoke old, create new)
  const newSessionId = uuidv4();
  const newRefreshToken = generateSecureToken();
  const newRefreshTokenHash = await hashToken(newRefreshToken);

  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.id, session.id));

  await db.insert(userSessions).values({
    id: newSessionId,
    userId: user.id,
    refreshTokenHash: newRefreshTokenHash,
    deviceInfo: meta.userAgent,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    expiresAt: addDays(new Date(), 365), // Sliding: reset to 1 year from now on every use
    lastUsedAt: new Date(),
  });

  const accessToken = fastify.jwt.sign({
    userId: user.id,
    email: user.email,
    role: user.role,
    orgId: user.organizationId,
    branchId: user.branchId,
    sessionId: newSessionId,
  });

  return { accessToken, refreshToken: newRefreshToken };
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logoutService(sessionId: string, userId: string, orgId: string, ipAddress?: string) {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)));

  await auditLog({
    organizationId: orgId,
    actorId: userId,
    action: AuditAction.LOGOUT,
    entityType: 'auth',
    entityId: sessionId,
    ipAddress,
  });
}

// ── Logout All Sessions ───────────────────────────────────────────────────────

export async function logoutAllService(userId: string, orgId: string, ipAddress?: string) {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));

  await auditLog({
    organizationId: orgId,
    actorId: userId,
    action: AuditAction.LOGOUT,
    entityType: 'auth',
    description: 'Logged out from all sessions',
    ipAddress,
  });
}

// ── Get Current User ──────────────────────────────────────────────────────────

export async function getMeService(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
      photoUrl: users.photoUrl,
      role: users.role,
      organizationId: users.organizationId,
      branchId: users.branchId,
      memberId: users.memberId,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) throw AppError.notFound(ErrorCode.STAFF_NOT_FOUND, 'User not found');

  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, user.organizationId))
    .limit(1);

  const orgBranches = await db
    .select()
    .from(branches)
    .where(eq(branches.organizationId, user.organizationId));

  let accessibleBranchIds: string[] = [];
  if (user.role === 'ORGANIZATION_OWNER' || user.role === 'OWNER') {
    accessibleBranchIds = orgBranches.map((b) => b.id);
  } else if (user.branchId) {
    accessibleBranchIds = [user.branchId];
  }

  const accessibleBranches = orgBranches.filter((b) => accessibleBranchIds.includes(b.id));

  const permissions = DEFAULT_ROLE_PERMISSIONS[user.role] ?? [];
  let portalType = getPortalType(user.role as UserRoleType);
  if (organization?.organizationMode === 'SINGLE_GYM' && portalType === 'org-owner') {
    portalType = 'branch';
  }

  return {
    ...user,
    orgId: user.organizationId,
    organization,
    branches: accessibleBranches,
    accessibleBranchIds,
    permissions,
    portalType,
  };
}

// ── List Active Sessions ──────────────────────────────────────────────────────

export async function getSessionsService(userId: string) {
  return db
    .select({
      id: userSessions.id,
      deviceInfo: userSessions.deviceInfo,
      ipAddress: userSessions.ipAddress,
      expiresAt: userSessions.expiresAt,
      lastUsedAt: userSessions.lastUsedAt,
      createdAt: userSessions.createdAt,
    })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(userSessions.createdAt);
}

// ── Revoke Session ────────────────────────────────────────────────────────────

export async function revokeSessionService(sessionId: string, userId: string) {
  const [session] = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)))
    .limit(1);

  if (!session) throw AppError.notFound(ErrorCode.SESSION_NOT_FOUND, 'Session not found');

  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.id, sessionId));
}

// ── Forgot Password ───────────────────────────────────────────────────────────

export async function forgotPasswordService(email: string, orgId: string, ipAddress?: string) {
  const [user] = await db
    .select({ id: users.id, email: users.email, organizationId: users.organizationId })
    .from(users)
    .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)))
    .limit(1);

  // Always return success to prevent email enumeration
  if (!user) {
    log.warn({ email }, 'Forgot password requested for non-existent email');
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  const rawToken = generateSecureToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = addMinutes(new Date(), config.passwordResetTokenExpiresMinutes);

  // Invalidate previous tokens
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  await auditLog({
    organizationId: user.organizationId,
    actorId: user.id,
    actorEmail: user.email,
    action: AuditAction.PASSWORD_RESET_REQUESTED,
    entityType: 'auth',
    ipAddress,
  });

  // In production: send email with reset link containing rawToken
  log.info({ userId: user.id, expiresAt }, 'Password reset token generated');

  return {
    message: 'If that email exists, a reset link has been sent.',
    // In development only — remove in production!
    ...(config.isDevelopment ? { devToken: rawToken } : {}),
  };
}

// ── Reset Password ─────────────────────────────────────────────────────────────

export async function resetPasswordService(token: string, newPassword: string, ipAddress?: string) {
  const tokenHash = await hashToken(token);

  const [resetToken] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!resetToken) {
    throw AppError.badRequest(
      ErrorCode.RESET_TOKEN_INVALID,
      'Reset token is invalid or has expired',
    );
  }

  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  await db
    .update(users)
    .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, resetToken.userId));

  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, resetToken.id));

  // Revoke all sessions (security: all devices must re-login)
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.userId, resetToken.userId));

  // Fetch user for org context
  const [user] = await db
    .select({ organizationId: users.organizationId })
    .from(users)
    .where(eq(users.id, resetToken.userId))
    .limit(1);

  await auditLog({
    organizationId: user?.organizationId ?? '',
    actorId: resetToken.userId,
    action: AuditAction.PASSWORD_RESET_COMPLETED,
    entityType: 'auth',
    ipAddress,
  });

  log.info({ userId: resetToken.userId }, 'Password reset completed');
}

// ── Change Password ───────────────────────────────────────────────────────────

export async function changePasswordService(
  userId: string,
  orgId: string,
  currentPassword: string,
  newPassword: string,
  ipAddress?: string,
) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) throw AppError.notFound(ErrorCode.STAFF_NOT_FOUND, 'User not found');

  const valid = await argon2.verify(user.passwordHash, currentPassword);
  if (!valid) {
    throw AppError.badRequest(ErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect');
  }

  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await auditLog({
    organizationId: orgId,
    actorId: userId,
    actorEmail: user.email,
    action: AuditAction.PASSWORD_CHANGED,
    entityType: 'auth',
    ipAddress,
  });
}

// ── Verify Staff Invite ───────────────────────────────────────────────────────

export async function verifyStaffInviteService(token: string) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const [invite] = await db
    .select()
    .from(staffInviteTokens)
    .where(eq(staffInviteTokens.tokenHash, tokenHash))
    .limit(1);

  if (!invite) {
    throw AppError.badRequest(ErrorCode.INVALID_TOKEN, 'Invalid invite token');
  }

  if (invite.acceptedAt) {
    throw AppError.badRequest(ErrorCode.INVALID_TOKEN, 'This invite link has already been used');
  }

  if (new Date() > invite.expiresAt) {
    throw AppError.badRequest(ErrorCode.INVALID_TOKEN, 'This invite link has expired');
  }

  const [user] = await db
    .select({ email: users.email, name: users.firstName })
    .from(users)
    .where(and(eq(users.id, invite.userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    throw AppError.badRequest(ErrorCode.STAFF_NOT_FOUND, 'User not found');
  }

  return { valid: true, email: user.email, name: user.name };
}

// ── Accept Staff Invite ───────────────────────────────────────────────────────

export async function acceptStaffInviteService(
  token: string,
  newPassword: string,
  ipAddress?: string,
) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const [invite] = await db
    .select()
    .from(staffInviteTokens)
    .where(eq(staffInviteTokens.tokenHash, tokenHash))
    .limit(1);

  if (!invite) {
    throw AppError.badRequest(ErrorCode.INVALID_TOKEN, 'Invalid or expired invite token');
  }

  if (invite.acceptedAt) {
    throw AppError.badRequest(ErrorCode.INVALID_TOKEN, 'Invite token has already been used');
  }

  if (new Date() > invite.expiresAt) {
    throw AppError.badRequest(ErrorCode.INVALID_TOKEN, 'Invite token has expired');
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, invite.userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    throw AppError.badRequest(ErrorCode.STAFF_NOT_FOUND, 'User not found');
  }

  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  await db
    .update(users)
    .set({
      passwordHash,
      isInvitePending: false,
      status: 'ACTIVE',
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await db
    .update(staffInviteTokens)
    .set({ acceptedAt: new Date() })
    .where(eq(staffInviteTokens.id, invite.id));

  await auditLog({
    organizationId: user.organizationId,
    actorId: user.id,
    actorEmail: user.email,
    action: AuditAction.STAFF_CREATED, // or a new action like INVITE_ACCEPTED
    entityType: 'auth',
    description: 'Staff member accepted invite and set password',
    ipAddress,
  });

  log.info({ userId: user.id }, 'Staff invite accepted');
}

