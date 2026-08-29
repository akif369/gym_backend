import { eq, sql } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config/env';
import { db } from '../../db/index';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { organizations, users, userSessions, branches, roles, settings, members, paymentTransactions, staffAuditLogs, platformAdmins } from '../../db/schema/index';
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
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      email: organizations.email,
      phone: organizations.phone,
      status: organizations.status,
      organizationMode: organizations.organizationMode,
      createdAt: organizations.createdAt,
      branchCount: sql<number>`(SELECT COUNT(*) FROM ${branches} b WHERE b.organization_id = ${organizations.id})`,
      activeBranchCount: sql<number>`(SELECT COUNT(*) FROM ${branches} b WHERE b.organization_id = ${organizations.id} AND b.status = 'ACTIVE')`,
      staffCount: sql<number>`(SELECT COUNT(*) FROM ${users} u WHERE u.organization_id = ${organizations.id} AND u.role <> 'MEMBER' AND u.deleted_at IS NULL)`,
      activeStaffCount: sql<number>`(SELECT COUNT(*) FROM ${users} u WHERE u.organization_id = ${organizations.id} AND u.role <> 'MEMBER' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL)`,
      memberCount: sql<number>`(SELECT COUNT(*) FROM ${members} m WHERE m.organization_id = ${organizations.id} AND m.deleted_at IS NULL)`,
      activeMemberCount: sql<number>`(SELECT COUNT(*) FROM ${members} m WHERE m.organization_id = ${organizations.id} AND m.status = 'ACTIVE' AND m.deleted_at IS NULL)`,
    })
    .from(organizations)
    .orderBy(sql`${organizations.createdAt} DESC`);

  return rows.map(row => ({
    ...row,
    branchCount: Number(row.branchCount) || 0,
    activeBranchCount: Number(row.activeBranchCount) || 0,
    staffCount: Number(row.staffCount) || 0,
    activeStaffCount: Number(row.activeStaffCount) || 0,
    memberCount: Number(row.memberCount) || 0,
    activeMemberCount: Number(row.activeMemberCount) || 0,
  }));
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

export async function getGlobalAuditLogs(page = 1, limit = 25, filters: { search?: string; action?: string; entityType?: string; organizationId?: string; branchId?: string; from?: string; to?: string } = {}) {
  const offset = (page - 1) * limit;
  const conditions = [sql`1 = 1`];
  const search = filters.search?.trim();
  if (search) conditions.push(sql`(${staffAuditLogs.actorEmail} ILIKE ${`%${search}%`} OR ${staffAuditLogs.description} ILIKE ${`%${search}%`} OR ${organizations.name} ILIKE ${`%${search}%`})`);
  if (filters.action?.trim()) conditions.push(sql`${staffAuditLogs.action} = ${filters.action.trim()}`);
  if (filters.entityType?.trim()) conditions.push(sql`${staffAuditLogs.entityType} = ${filters.entityType.trim()}`);
  if (filters.organizationId?.trim()) conditions.push(sql`${staffAuditLogs.organizationId} = ${filters.organizationId.trim()}`);
  if (filters.branchId?.trim()) conditions.push(sql`${staffAuditLogs.actorId} IN (SELECT u.id FROM ${users} u WHERE u.branch_id = ${filters.branchId.trim()})`);
  if (filters.from) conditions.push(sql`${staffAuditLogs.createdAt} >= ${filters.from}`);
  if (filters.to) conditions.push(sql`${staffAuditLogs.createdAt} < ${filters.to}`);
  const where = sql.join(conditions, sql` AND `);
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(staffAuditLogs).leftJoin(organizations, eq(staffAuditLogs.organizationId, organizations.id)).where(where);
  const logs = await db
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
    .where(where)
    .orderBy(sql`${staffAuditLogs.createdAt} DESC`)
    .limit(limit)
    .offset(offset);
  return { logs, total: Number(countResult?.count || 0), page, limit };
}

export async function getOrganizationUsers(orgId: string, page = 1, limit = 10, filters: { search?: string; status?: string; role?: string } = {}) {
  const offset = (page - 1) * limit;
  const search = filters.search?.trim();
  const conditions = [sql`${users.organizationId} = ${orgId}`, sql`${users.role} != 'MEMBER'`];
  if (search) conditions.push(sql`(${users.firstName} ILIKE ${`%${search}%`} OR ${users.lastName} ILIKE ${`%${search}%`} OR ${users.email} ILIKE ${`%${search}%`})`);
  if (filters.status && ['ACTIVE', 'INACTIVE'].includes(filters.status)) conditions.push(sql`${users.status} = ${filters.status}`);
  if (filters.role && ['OWNER', 'ADMIN', 'STAFF', 'TRAINER', 'RECEPTIONIST'].includes(filters.role)) conditions.push(sql`${users.role} = ${filters.role}`);
  const where = sql.join(conditions, sql` AND `);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(where);

  const total = Number(countResult?.count || 0);

  const data = await db
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
    .where(where)
    .orderBy(sql`${users.createdAt} ASC`)
    .limit(limit)
    .offset(offset);

  return { users: data, total, page, limit };
}

export async function getOrganizationMembers(orgId: string, page = 1, limit = 10, filters: { search?: string; status?: string } = {}) {
  const offset = (page - 1) * limit;
  const search = filters.search?.trim();
  const conditions = [sql`${members.organizationId} = ${orgId}`];
  if (search) conditions.push(sql`(${members.firstName} ILIKE ${`%${search}%`} OR ${members.lastName} ILIKE ${`%${search}%`} OR ${members.memberNumber} ILIKE ${`%${search}%`} OR ${members.email} ILIKE ${`%${search}%`} OR ${members.phone} ILIKE ${`%${search}%`})`);
  if (filters.status && ['ACTIVE', 'INACTIVE', 'FROZEN', 'EXPIRED', 'ARCHIVED'].includes(filters.status)) conditions.push(sql`${members.status} = ${filters.status}`);
  const where = sql.join(conditions, sql` AND `);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(members)
    .where(where);

  const total = Number(countResult?.count || 0);

  const data = await db
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
      deletedAt: members.deletedAt,
    })
    .from(members)
    .where(where)
    .orderBy(sql`${members.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return { members: data, total, page, limit };
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

export async function resetAdminUserPassword(userId: string, newPassword: string) {
  const passwordHash = await argon2.hash(newPassword);
  const [user] = await db
    .update(users)
    .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
    .where(sql`${users.id} = ${userId} AND ${users.deletedAt} IS NULL`)
    .returning({ id: users.id });

  if (!user) throw AppError.notFound(ErrorCode.STAFF_NOT_FOUND, 'User not found');

  await db.update(userSessions)
    .set({ revokedAt: new Date() })
    .where(sql`${userSessions.userId} = ${userId} AND ${userSessions.revokedAt} IS NULL`);

  return { success: true, id: user.id };
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

export async function deleteAdminMember(memberId: string) {
  const [deletedMember] = await db
    .delete(members)
    .where(eq(members.id, memberId))
    .returning({ id: members.id });

  if (!deletedMember) {
    throw AppError.notFound(ErrorCode.NOT_FOUND, 'Member not found');
  }

  return { success: true, id: deletedMember.id };
}

export async function deleteAdminBranch(branchId: string) {
  const [deletedBranch] = await db
    .delete(branches)
    .where(eq(branches.id, branchId))
    .returning({ id: branches.id });

  if (!deletedBranch) {
    throw AppError.notFound(ErrorCode.NOT_FOUND, 'Branch not found');
  }

  return { success: true, id: deletedBranch.id };
}

export async function deleteAdminOrganization(orgId: string) {
  const [deletedOrg] = await db
    .delete(organizations)
    .where(eq(organizations.id, orgId))
    .returning({ id: organizations.id });

  if (!deletedOrg) {
    throw AppError.notFound(ErrorCode.ORG_NOT_FOUND, 'Organization not found');
  }

  return { success: true, id: deletedOrg.id };
}
