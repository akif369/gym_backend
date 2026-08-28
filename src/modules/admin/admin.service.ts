import { eq, sql } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config/env';
import { db } from '../../db/index';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { organizations, users, branches, roles, settings, members, paymentTransactions, staffAuditLogs, platformAdmins } from '../../db/schema/index';
import type { FastifyInstance } from 'fastify';

export async function superAdminLogin(fastify: FastifyInstance, payload: any) {
  const { email, password } = payload;
  
  const normalizedEmail = email.trim().toLowerCase();
  
  const [admin] = await db
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.email, normalizedEmail));

  if (!admin) {
    throw AppError.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid admin credentials');
  }

  if (admin.status !== 'ACTIVE') {
    throw AppError.forbidden(ErrorCode.ACCOUNT_INACTIVE, 'Account is inactive or suspended');
  }

  if (admin.lockedUntil && new Date() < admin.lockedUntil) {
    throw AppError.forbidden(ErrorCode.ACCOUNT_LOCKED, 'Account is temporarily locked. Try again later.');
  }

  const isValid = await argon2.verify(admin.passwordHash, password);

  if (!isValid) {
    const newFailCount = admin.failedLoginAttempts + 1;
    let lockedUntil = null;
    
    // Lock for 15 minutes after 5 failed attempts
    if (newFailCount >= 5) {
      lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    
    await db.update(platformAdmins)
      .set({ failedLoginAttempts: newFailCount, lockedUntil })
      .where(eq(platformAdmins.id, admin.id));
      
    throw AppError.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid admin credentials');
  }

  // Reset failed attempts and update last login
  await db.update(platformAdmins)
    .set({ 
      failedLoginAttempts: 0, 
      lockedUntil: null,
      lastLoginAt: new Date()
    })
    .where(eq(platformAdmins.id, admin.id));

  // Create a dummy session ID since we don't track super admin sessions in the DB right now
  const sessionId = uuidv4();

  // Sign access token
  const accessToken = fastify.jwt.sign({
    userId: admin.id,
    email: admin.email,
    role: admin.role,
    type: 'platform_admin',
    orgId: 'system',
    sessionId,
  });

  return { accessToken, user: { id: admin.id, email: admin.email, role: admin.role } };
}

export async function getAdminStats() {
  const [orgCount] = await db.select({ count: sql<number>`count(*)` }).from(organizations);
  const [memberCount] = await db.select({ count: sql<number>`count(*)` }).from(members);
  const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
  
  const [revenue] = await db.select({ 
    total: sql<number>`COALESCE(SUM(${paymentTransactions.totalAmount}), 0)` 
  }).from(paymentTransactions);

  return {
    totalOrganizations: Number(orgCount?.count) || 0,
    totalMembers: Number(memberCount?.count) || 0,
    totalUsers: Number(userCount?.count) || 0,
    totalPlatformRevenue: Number(revenue?.total) || 0,
  };
}

export async function listOrganizations() {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      email: organizations.email,
      phone: organizations.phone,
      status: organizations.status,
      organizationMode: organizations.organizationMode,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .orderBy(sql`${organizations.createdAt} DESC`);
}

export async function updateOrganizationStatus(orgId: string, status: 'ACTIVE' | 'SUSPENDED') {
  const [org] = await db
    .update(organizations)
    .set({ status, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning();
    
  if (!org) {
    throw AppError.notFound(ErrorCode.ORG_NOT_FOUND, 'Organization not found');
  }
  return org;
}

export async function updateOrganizationMode(orgId: string, mode: 'SINGLE_GYM' | 'MULTI_GYM') {
  // Downgrade guard: only allow MULTI_GYM → SINGLE_GYM if exactly 1 active branch exists
  if (mode === 'SINGLE_GYM') {
    const activeBranches = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.organizationId, orgId));
    if (activeBranches.length > 1) {
      throw AppError.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Cannot switch to Single Gym mode: organization has more than one branch. Deactivate extra branches first.',
      );
    }
  }

  const [org] = await db
    .update(organizations)
    .set({ organizationMode: mode, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning();

  if (!org) {
    throw AppError.notFound(ErrorCode.ORG_NOT_FOUND, 'Organization not found');
  }
  return org;
}

export async function getOrganizationBranches(orgId: string) {
  return db
    .select({
      id: branches.id,
      name: branches.name,
      address: branches.address,
      city: branches.city,
      status: branches.status,
      capacity: branches.capacity,
      isMainBranch: branches.isMainBranch,
    })
    .from(branches)
    .where(eq(branches.organizationId, orgId))
    .orderBy(sql`${branches.createdAt} ASC`);
}

export async function resetOrganizationOwnerPassword(orgId: string, newPassword: string) {
  // Find the user with role OWNER for this org
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.organizationId} = ${orgId} AND ${users.role} = 'OWNER'`)
    .limit(1);

  if (!owner) {
    throw AppError.notFound(ErrorCode.STAFF_NOT_FOUND, 'No OWNER user found for this organization');
  }

  const hashedPassword = await argon2.hash(newPassword);

  await db
    .update(users)
    .set({ passwordHash: hashedPassword, updatedAt: new Date() })
    .where(eq(users.id, owner.id));

  return { success: true };
}

export async function createOrganization(payload: any) {
  const { orgName, orgEmail, branchName, city, ownerFirstName, ownerLastName, ownerEmail, ownerPassword, mode } = payload;
  
  // Transaction to ensure atomicity
  return await db.transaction(async (tx) => {
    // 1. Create Organization
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).substring(2, 6);
    const [newOrg] = await tx.insert(organizations).values({
      name: orgName,
      slug,
      email: orgEmail,
      organizationMode: mode === 'MULTI_GYM' ? 'MULTI_GYM' : 'SINGLE_GYM',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
    }).returning();
    if (!newOrg) throw new Error('Failed to create organization');

    // 2. Create Main Branch
    const [newBranch] = await tx.insert(branches).values({
      organizationId: newOrg.id,
      name: branchName,
      city,
      isMainBranch: true,
    }).returning();
    if (!newBranch) throw new Error('Failed to create branch');

    // 3. Create Owner User
    const hashedPassword = await argon2.hash(ownerPassword);
    const [newOwner] = await tx.insert(users).values({
      organizationId: newOrg.id,
      branchId: newBranch.id,
      email: ownerEmail,
      passwordHash: hashedPassword,
      role: 'OWNER',
      firstName: ownerFirstName,
      lastName: ownerLastName,
    }).returning();
    if (!newOwner) throw new Error('Failed to create owner');

    return {
      organization: newOrg,
      branch: newBranch,
      owner: { id: newOwner.id, email: newOwner.email, role: newOwner.role }
    };
  });
}

export async function getGlobalAuditLogs() {
  return await db
    .select({
      id: staffAuditLogs.id,
      organizationId: staffAuditLogs.organizationId,
      organizationName: organizations.name,
      actorEmail: staffAuditLogs.actorEmail,
      actorRole: staffAuditLogs.actorRole,
      entityType: staffAuditLogs.entityType,
      action: staffAuditLogs.action,
      description: staffAuditLogs.description,
      createdAt: staffAuditLogs.createdAt,
    })
    .from(staffAuditLogs)
    .leftJoin(organizations, eq(staffAuditLogs.organizationId, organizations.id))
    .orderBy(sql`${staffAuditLogs.createdAt} DESC`)
    .limit(100);
}

export async function getOrganizationUsers(orgId: string) {
  // Return all staff users (filtering out MEMBER role)
  return await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      status: users.status,
      branchId: users.branchId,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(sql`${users.organizationId} = ${orgId} AND ${users.role} != 'MEMBER'`)
    .orderBy(sql`${users.createdAt} ASC`);
}

export async function getOrganizationMembers(orgId: string) {
  return await db
    .select({
      id: members.id,
      memberNumber: members.memberNumber,
      firstName: members.firstName,
      lastName: members.lastName,
      email: members.email,
      phone: members.phone,
      status: members.status,
      branchId: members.branchId,
      joinDate: members.joinDate,
      createdAt: members.createdAt,
    })
    .from(members)
    .where(eq(members.organizationId, orgId))
    .orderBy(sql`${members.createdAt} DESC`);
}

export async function updateAdminUser(userId: string, payload: { firstName?: string; lastName?: string; role?: any; status?: 'ACTIVE' | 'INACTIVE'; branchId?: string | null }) {
  const [user] = await db
    .update(users)
    .set({
      ...payload,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  if (!user) {
    throw AppError.notFound(ErrorCode.STAFF_NOT_FOUND, 'User not found');
  }

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    branchId: user.branchId,
  };
}

export async function deleteAdminUser(userId: string) {
  // Hard delete the user
  const [deletedUser] = await db
    .delete(users)
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  if (!deletedUser) {
    throw AppError.notFound(ErrorCode.STAFF_NOT_FOUND, 'User not found');
  }

  return { success: true, id: deletedUser.id };
}
