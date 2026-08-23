import { db } from '../../db/index';
import {
  members, memberEmergencyContacts, memberHealthProfiles, memberMeasurements,
} from '../../db/schema/index';
import { trainers, trainerAssignments } from '../../db/schema/trainers.schema';
import { memberMemberships } from '../../db/schema/memberships.schema';
import { attendanceLogs } from '../../db/schema/attendance.schema';
import { paymentTransactions } from '../../db/schema/payments.schema';
import { ptSessions } from '../../db/schema/pt.schema';
import { membershipEvents } from '../../db/schema/memberships.schema';
import { eq, and, isNull, ilike, or, desc, asc, sql, count, lt, lte, gte } from 'drizzle-orm';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { parsePagination, paginationToLimitOffset, buildPaginatedResponse } from '../../common/pagination/paginate';
import { auditLog } from '../../common/audit/auditLog';
import { AuditAction } from '../../db/schema/audit.schema';
import { createLogger } from '../../common/logger/index';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config/env';
import { sendTextMessage } from '../notifications/notifications.service';

const log = createLogger('members-service');

const GYM_QUOTES = [
  "Discipline beats motivation.",
  "No excuses. Just results.",
  "Train hard. Stay humble.",
  "One more rep. One more step.",
  "Earn your strength.",
  "Your only competition is yesterday's you.",
  "Small progress is still progress.",
  "Be stronger than your excuses.",
  "Show up. Put in the work. Repeat.",
  "Pain is temporary. Pride lasts forever.",
  "Dream big. Train bigger.",
  "Don't wish for it. Work for it.",
  "Every rep makes you stronger.",
  "Build the body. Build the mindset.",
  "Stay consistent. Results will follow.",
  "The struggle today builds the strength of tomorrow.",
  "You don't need motivation. You need discipline.",
  "Get comfortable being uncomfortable.",
  "Start where you are. Become who you want to be.",
  "Your future self will thank you."
];

function normalizeIndianMobile(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const localNumber = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(localNumber)) {
    throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Phone must be a valid 10-digit Indian mobile number');
  }
  return `+91${localNumber}`;
}

// ── Helper: generate member number ───────────────────────────────────────────

async function generateMemberNumber(orgId: string): Promise<string> {
  const totalRes = await db
    .select({ total: count() })
    .from(members)
    .where(eq(members.organizationId, orgId));
  const nextNum = (totalRes[0]?.total ?? 0) + 1;
  return `GYM${String(nextNum).padStart(4, '0')}`;
}

// ── List Members ──────────────────────────────────────────────────────────────

export async function listMembersService(orgId: string, query: Record<string, unknown>) {
  const { page, pageSize } = parsePagination(query);
  const { limit, offset } = paginationToLimitOffset({ page, pageSize });

  const search = query['search'] as string | undefined;
  const membershipStatus = query['membershipStatus'] as string | undefined;
  const status = query['status'] as string | undefined;
  const branchId = query['branchId'] as string | undefined;

  const conditions: any[] = [
    eq(members.organizationId, orgId),
    isNull(members.deletedAt),
  ];

  if (search) {
    conditions.push(
      or(
        ilike(members.firstName, `%${search}%`),
        ilike(members.lastName, `%${search}%`),
        ilike(members.phone, `%${search}%`),
        ilike(members.email!, `%${search}%`),
        ilike(members.memberNumber, `%${search}%`),
      ),
    );
  }

  if (status) {
    conditions.push(eq(members.status, status as any));
  }

  if (branchId) {
    conditions.push(eq(members.branchId, branchId));
  }

  if (membershipStatus) {
    if (membershipStatus === 'INACTIVE') {
      conditions.push(
        or(
          eq(members.status, 'INACTIVE'),
          sql`(
            SELECT count(*)
            FROM ${sql.identifier('member_memberships')}
            WHERE ${sql.identifier('member_memberships')}.${sql.identifier('member_id')} = ${sql.identifier('members')}.${sql.identifier('id')}
          ) = 0`,
          sql`(
            SELECT ${sql.identifier('member_memberships')}.${sql.identifier('status')}
            FROM ${sql.identifier('member_memberships')}
            WHERE ${sql.identifier('member_memberships')}.${sql.identifier('member_id')} = ${sql.identifier('members')}.${sql.identifier('id')}
            ORDER BY ${sql.identifier('member_memberships')}.${sql.identifier('created_at')} DESC
            LIMIT 1
          ) = 'CANCELLED'`
        )
      );
    } else {
      conditions.push(sql`(
        SELECT ${sql.identifier('member_memberships')}.${sql.identifier('status')}
        FROM ${sql.identifier('member_memberships')}
        WHERE ${sql.identifier('member_memberships')}.${sql.identifier('member_id')} = ${sql.identifier('members')}.${sql.identifier('id')}
        ORDER BY ${sql.identifier('member_memberships')}.${sql.identifier('created_at')} DESC
        LIMIT 1
      ) = ${membershipStatus}`);
    }
  }

  const whereClause = and(...conditions);

  const totalRes = await db
    .select({ total: count() })
    .from(members)
    .where(whereClause);
  const total = totalRes[0]?.total ?? 0;

  const qualifiedColumn = (table: string, column: string) =>
    sql`${sql.identifier(table)}.${sql.identifier(column)}`;

  // Fetch members with latest membership info via subquery
  const items = await db
    .select({
      id: members.id,
      memberNumber: members.memberNumber,
      firstName: members.firstName,
      lastName: members.lastName,
      email: members.email,
      phone: members.phone,
      gender: members.gender,
      photoUrl: members.photoUrl,
      status: members.status,
      joinDate: members.joinDate,
      goal: members.goal,
      experienceLevel: members.experienceLevel,
      branchId: members.branchId,
      createdAt: members.createdAt,
      membershipPlan: sql<string | null>`(
        SELECT ${qualifiedColumn('member_memberships', 'plan_name')}
        FROM ${sql.identifier('member_memberships')}
        WHERE ${qualifiedColumn('member_memberships', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('member_memberships', 'created_at')} DESC
        LIMIT 1
      )`,
      membershipStart: sql<string | null>`(
        SELECT ${qualifiedColumn('member_memberships', 'start_date')}
        FROM ${sql.identifier('member_memberships')}
        WHERE ${qualifiedColumn('member_memberships', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('member_memberships', 'created_at')} DESC
        LIMIT 1
      )`,
      membershipExpiry: sql<string | null>`(
        SELECT ${qualifiedColumn('member_memberships', 'end_date')}
        FROM ${sql.identifier('member_memberships')}
        WHERE ${qualifiedColumn('member_memberships', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('member_memberships', 'created_at')} DESC
        LIMIT 1
      )`,
      membershipStatus: sql<string | null>`(
        SELECT ${qualifiedColumn('member_memberships', 'status')}
        FROM ${sql.identifier('member_memberships')}
        WHERE ${qualifiedColumn('member_memberships', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('member_memberships', 'created_at')} DESC
        LIMIT 1
      )`,
      lastVisit: sql<Date | null>`(
        SELECT ${qualifiedColumn('attendance_logs', 'check_in_at')}
        FROM ${sql.identifier('attendance_logs')}
        WHERE ${qualifiedColumn('attendance_logs', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('attendance_logs', 'check_in_at')} DESC
        LIMIT 1
      )`,
      trainerName: sql<string | null>`(
        SELECT ${qualifiedColumn('trainers', 'name')}
        FROM ${sql.identifier('trainer_assignments')}
        INNER JOIN ${sql.identifier('trainers')}
          ON ${qualifiedColumn('trainers', 'id')} = ${qualifiedColumn('trainer_assignments', 'trainer_id')}
        WHERE ${qualifiedColumn('trainer_assignments', 'member_id')} = ${qualifiedColumn('members', 'id')}
          AND ${qualifiedColumn('trainer_assignments', 'unassigned_at')} IS NULL
        ORDER BY ${qualifiedColumn('trainer_assignments', 'assigned_at')} DESC
        LIMIT 1
      )`,
      paymentStatus: sql<string | null>`(
        SELECT ${qualifiedColumn('payment_transactions', 'status')}
        FROM ${sql.identifier('payment_transactions')}
        WHERE ${qualifiedColumn('payment_transactions', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('payment_transactions', 'created_at')} DESC
        LIMIT 1
      )`,
    })
    .from(members)
    .where(whereClause)
    .orderBy(desc(members.createdAt))
    .limit(limit)
    .offset(offset);

  return buildPaginatedResponse(items, total ?? 0, { page, pageSize });
}

// ── Create Member ─────────────────────────────────────────────────────────────

export async function createMemberService(
  orgId: string,
  data: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    gender?: string;
    dob?: string;
    address?: string;
    goal?: string;
    experienceLevel?: string;
    branchId?: string;
    joinDate: string;
    notes?: string;
    emergency?: { name: string; phone: string; relation: string };
    health?: { medicalConditions?: string; allergies?: string; injuries?: string; bloodGroup?: string };
  },
  actorId: string,
) {
  const memberNumber = await generateMemberNumber(orgId);
  const phone = normalizeIndianMobile(data.phone);

  const [member] = await db
    .insert(members)
    .values({
      organizationId: orgId,
      branchId: data.branchId,
      memberNumber,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone,
      gender: data.gender as any,
      dob: data.dob,
      address: data.address,
      goal: data.goal,
      experienceLevel: data.experienceLevel as any,
      joinDate: data.joinDate,
      notes: data.notes,
    })
    .returning();

  if (!member) throw AppError.internal('Failed to create member');

  // Emergency contact
  if (data.emergency) {
    await db.insert(memberEmergencyContacts).values({
      memberId: member.id,
      name: data.emergency.name,
      phone: data.emergency.phone,
      relation: data.emergency.relation,
    });
  }

  // Health profile
  if (data.health) {
    await db.insert(memberHealthProfiles).values({
      memberId: member.id,
      ...data.health,
    });
  }

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.MEMBER_CREATED,
    entityType: 'member',
    entityId: member.id,
    description: `Member ${member.memberNumber} created: ${member.firstName} ${member.lastName}`,
  });

  log.info({ memberId: member.id, memberNumber }, 'Member created');

  try {
    const quote = GYM_QUOTES[Math.floor(Math.random() * GYM_QUOTES.length)];
    const text = `Welcome to the gym, ${member.firstName} ${member.lastName}! Thank you for joining us.\n\n> ${quote}`;
    sendTextMessage({
      organizationId: orgId,
      memberId: member.id,
      eventType: 'WELCOME',
      phone: member.phone,
      text,
      idempotencyKey: `welcome_${member.id}`,
      actorId,
    }).catch(err => log.error({ err, memberId: member.id }, 'Failed to send welcome message'));
  } catch (err) {
    log.error({ err, memberId: member.id }, 'Failed to initiate welcome message');
  }

  return member;
}

// ── Get Member ────────────────────────────────────────────────────────────────

export async function getMemberService(orgId: string, memberId: string) {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt)))
    .limit(1);

  if (!member) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  // Emergency contact
  const [emergency] = await db
    .select()
    .from(memberEmergencyContacts)
    .where(eq(memberEmergencyContacts.memberId, memberId))
    .limit(1);

  // Health profile
  const [health] = await db
    .select()
    .from(memberHealthProfiles)
    .where(eq(memberHealthProfiles.memberId, memberId))
    .limit(1);

  // Active trainer assignment
  const [assignment] = await db
    .select({ trainer: trainers })
    .from(trainerAssignments)
    .innerJoin(trainers, eq(trainers.id, trainerAssignments.trainerId))
    .where(and(
      eq(trainerAssignments.memberId, memberId),
      isNull(trainerAssignments.unassignedAt),
    ))
    .limit(1);

  // Latest membership
  const [latestMembership] = await db
    .select()
    .from(memberMemberships)
    .where(eq(memberMemberships.memberId, memberId))
    .orderBy(desc(memberMemberships.createdAt))
    .limit(1);

  return {
    ...member,
    emergency: emergency ?? null,
    health: health ?? null,
    trainer: assignment?.trainer ?? null,
    latestMembership: latestMembership ?? null,
  };
}

// ── Update Member ─────────────────────────────────────────────────────────────

export async function updateMemberService(
  orgId: string,
  memberId: string,
  data: Partial<typeof members.$inferInsert>,
  actorId: string,
) {
  const before = await getMemberService(orgId, memberId);
  const updateData = data.phone === undefined
    ? data
    : { ...data, phone: normalizeIndianMobile(data.phone) };

  const [updated] = await db
    .update(members)
    .set({ ...updateData, updatedAt: new Date() })
    .where(and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt)))
    .returning();

  if (!updated) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.MEMBER_UPDATED,
    entityType: 'member',
    entityId: memberId,
    beforeState: before,
    afterState: updated,
  });

  return updated;
}

// ── Update Member Status ──────────────────────────────────────────────────────

export async function updateMemberStatusService(
  orgId: string,
  memberId: string,
  status: string,
  actorId: string,
) {
  const allowedStatuses = ['ACTIVE', 'FROZEN', 'EXPIRED', 'ARCHIVED'] as const;
  if (!allowedStatuses.includes(status as (typeof allowedStatuses)[number])) {
    throw AppError.badRequest(ErrorCode.BAD_REQUEST, `Unsupported member status: ${status}`);
  }

  const [updated] = await db
    .update(members)
    .set({ status: status as any, updatedAt: new Date() })
    .where(and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt)))
    .returning({ id: members.id, status: members.status });

  if (!updated) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.MEMBER_STATUS_CHANGED,
    entityType: 'member',
    entityId: memberId,
    description: `Status changed to ${status}`,
  });

  return updated;
}

// ── Delete Member ─────────────────────────────────────────────────────────────

export async function deleteMemberService(
  orgId: string,
  memberId: string,
  actorId: string,
) {
  const [updated] = await db
    .update(members)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt)))
    .returning({ id: members.id });

  if (!updated) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.MEMBER_STATUS_CHANGED, // Or create AuditAction.MEMBER_DELETED
    entityType: 'member',
    entityId: memberId,
    description: 'Member soft-deleted',
  });

  return { success: true };
}

// ── Member Activity Timeline ──────────────────────────────────────────────────

export async function getMemberActivityService(orgId: string, memberId: string) {
  await getMemberService(orgId, memberId); // validates access

  // Gather events from multiple sources and merge
  const [attendances, payments, membershipEvts] = await Promise.all([
    db.select({
      createdAt: attendanceLogs.checkInAt,
      type: sql<string>`'ATTENDANCE'`.as('type'),
      description: sql<string>`'Checked in'`.as('description'),
    }).from(attendanceLogs)
      .where(eq(attendanceLogs.memberId, memberId))
      .orderBy(desc(attendanceLogs.checkInAt))
      .limit(20),

    db.select({
      createdAt: paymentTransactions.createdAt,
      type: sql<string>`'PAYMENT'`.as('type'),
      description: sql<string>`concat('Payment ₹', payment_transactions.total_amount, ' received (', payment_transactions.payment_method, ')')`.as('description'),
    }).from(paymentTransactions)
      .where(eq(paymentTransactions.memberId, memberId))
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(20),

    db.select({
      createdAt: membershipEvents.createdAt,
      type: membershipEvents.eventType,
      description: membershipEvents.notes,
    }).from(membershipEvents)
      .where(eq(membershipEvents.memberId, memberId))
      .orderBy(desc(membershipEvents.createdAt))
      .limit(20),
  ]);

  const timeline = [...attendances, ...payments, ...membershipEvts]
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, 50);

  return timeline;
}

// ── Member Measurements ───────────────────────────────────────────────────────

export async function getMemberMeasurementsService(orgId: string, memberId: string) {
  await getMemberService(orgId, memberId);

  return db
    .select()
    .from(memberMeasurements)
    .where(eq(memberMeasurements.memberId, memberId))
    .orderBy(desc(memberMeasurements.recordedAt));
}

export async function addMemberMeasurementService(
  orgId: string,
  memberId: string,
  data: Omit<typeof memberMeasurements.$inferInsert, 'id' | 'memberId' | 'createdAt'>,
  actorId: string,
) {
  await getMemberService(orgId, memberId); // validate

  const [measurement] = await db
    .insert(memberMeasurements)
    .values({ ...data, memberId, recordedBy: actorId })
    .returning();

  return measurement;
}

// ── Health Profile ────────────────────────────────────────────────────────────

export async function getMemberHealthProfileService(orgId: string, memberId: string) {
  await getMemberService(orgId, memberId);

  const [health] = await db
    .select()
    .from(memberHealthProfiles)
    .where(eq(memberHealthProfiles.memberId, memberId))
    .limit(1);

  return health ?? null;
}

export async function updateMemberHealthProfileService(
  orgId: string,
  memberId: string,
  data: Partial<typeof memberHealthProfiles.$inferInsert>,
  actorId: string,
) {
  await getMemberService(orgId, memberId);

  const [existing] = await db
    .select({ id: memberHealthProfiles.id })
    .from(memberHealthProfiles)
    .where(eq(memberHealthProfiles.memberId, memberId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(memberHealthProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(memberHealthProfiles.id, existing.id))
      .returning();
    await auditLog({
      organizationId: orgId,
      actorId,
      action: AuditAction.MEMBER_UPDATED,
      entityType: 'member',
      entityId: memberId,
      description: 'Sensitive health profile updated',
    });
    return updated;
  } else {
    const [created] = await db
      .insert(memberHealthProfiles)
      .values({ memberId, ...data })
      .returning();
    await auditLog({
      organizationId: orgId,
      actorId,
      action: AuditAction.MEMBER_UPDATED,
      entityType: 'member',
      entityId: memberId,
      description: 'Sensitive health profile created',
    });
    return created;
  }
}

// ── Upload Member Photo ───────────────────────────────────────────────────────

export async function uploadMemberPhotoService(
  orgId: string,
  memberId: string,
  fileBuffer: Buffer,
  filename: string,
  actorId: string,
) {
  await getMemberService(orgId, memberId);

  const ext = path.extname(filename).toLowerCase() || '.jpg';
  const photoKey = `avatars/${orgId}/${memberId}-${Date.now()}${ext}`;
  
  const { uploadFileToS3 } = await import('../../common/storage/s3');
  // Determine mime type
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const photoUrl = await uploadFileToS3(photoKey, fileBuffer, mimeType);

  await db
    .update(members)
    .set({ photoUrl, updatedAt: new Date() })
    .where(eq(members.id, memberId));

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.MEMBER_PHOTO_UPLOADED,
    entityType: 'member',
    entityId: memberId,
  });

  return { photoUrl };
}

// ── Delete Member Photo ───────────────────────────────────────────────────────

export async function deleteMemberPhotoService(
  orgId: string,
  memberId: string,
  actorId: string,
) {
  const member = await getMemberService(orgId, memberId);
  if (!member.photoUrl) {
    return { success: true };
  }

  const { deleteFileFromS3 } = await import('../../common/storage/s3');
  const bucketName = config.s3.bucketName;
  // Extract key from URL
  // Example URL: http://localhost:3900/gymatrix-image/avatars/org/member-123.jpg
  // Key is: avatars/org/member-123.jpg
  try {
    const url = new URL(member.photoUrl);
    // Pathname might be /gymatrix-image/avatars/...
    // We want everything after /bucketName/
    const pathParts = url.pathname.split(`/${bucketName}/`);
    if (pathParts.length > 1 && pathParts[1]) {
      const key = pathParts[1];
      await deleteFileFromS3(key);
    }
  } catch (err) {
    log.warn({ err, photoUrl: member.photoUrl }, 'Failed to parse or delete S3 object, ignoring.');
  }

  await db
    .update(members)
    .set({ photoUrl: null, updatedAt: new Date() })
    .where(eq(members.id, memberId));

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.MEMBER_UPDATED,
    entityType: 'member',
    entityId: memberId,
    description: 'Member photo deleted',
  });

  return { success: true };
}
