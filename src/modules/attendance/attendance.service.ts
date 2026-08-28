import { db } from '../../db/index';
import { attendanceLogs } from '../../db/schema/attendance.schema';
import { members } from '../../db/schema/members.schema';
import { memberMemberships } from '../../db/schema/memberships.schema';
import { paymentTransactions } from '../../db/schema/payments.schema';
import { eq, and, or, isNull, desc, count, sql, gte, lte, lt, gt, between } from 'drizzle-orm';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { parseCursorPagination, decodeCursor, buildCursorPaginatedResponse } from '../../common/pagination/paginate';
import { auditLog } from '../../common/audit/auditLog';
import { AuditAction } from '../../db/schema/audit.schema';
import { createLogger } from '../../common/logger/index';
import { isStrictPaymentPolicyEnabled } from '../org/org.service';
import { istDayStart, istDayEnd } from '../../common/utils/timezone';
import { TenantContext, tenantWhere, accessibleBranchesWhere, assertBranchAccess } from '../../common/auth/tenant';

const log = createLogger('attendance-service');

// ── Check-In ──────────────────────────────────────────────────────────────────

export async function checkInService(
  ctx: TenantContext,
  data: { memberId?: string; memberNumber?: string; method?: string; notes?: string; branchId?: string },
) {
  // Resolve member
  let member;
  if (data.memberId) {
    const [m] = await db
      .select()
      .from(members)
      .where(and(eq(members.id, data.memberId), tenantWhere(members, ctx), accessibleBranchesWhere(members, ctx), isNull(members.deletedAt)))
      .limit(1);
    member = m;
  } else if (data.memberNumber) {
    const [m] = await db
      .select()
      .from(members)
      .where(and(eq(members.memberNumber, data.memberNumber), tenantWhere(members, ctx), accessibleBranchesWhere(members, ctx), isNull(members.deletedAt)))
      .limit(1);
    member = m;
  }

  if (!member) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');
  
  const branchId = data.branchId || member.branchId || ctx.activeBranchId;
  if (branchId) {
    assertBranchAccess(ctx, branchId);
  }

  // Prevent duplicate active check-in
  const [activeSession] = await db
    .select({ id: attendanceLogs.id })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.memberId, member.id),
        isNull(attendanceLogs.checkOutAt),
      ),
    )
    .limit(1);

  if (activeSession) {
    throw AppError.conflict(ErrorCode.ALREADY_CHECKED_IN, 'Member is already checked in');
  }

  // Validate membership is active.
  const [activeMembership] = await db
    .select({ status: memberMemberships.status, endDate: memberMemberships.endDate, createdAt: memberMemberships.createdAt })
    .from(memberMemberships)
    .where(and(eq(memberMemberships.memberId, member.id), eq(memberMemberships.status, 'ACTIVE')))
    .limit(1);

  const strictPaymentPolicy = await isStrictPaymentPolicyEnabled(ctx.organizationId);
  let latestPaymentStatus: string | null = null;
  let latestPayment: { status: string; createdAt: Date } | undefined;
  if (strictPaymentPolicy) {
    [latestPayment] = await db
      .select({ status: paymentTransactions.status, createdAt: paymentTransactions.createdAt })
      .from(paymentTransactions)
      .where(and(
        eq(paymentTransactions.memberId, member.id),
        tenantWhere(paymentTransactions, ctx),
      ))
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(1);
    latestPaymentStatus = latestPayment?.status ?? null;
  }

  if (!activeMembership) {
    log.warn({ memberId: member.id }, 'Check-in attempted without active membership');
  }

  const paymentCoversMembership = Boolean(
    activeMembership
    && latestPaymentStatus === 'PAID'
    && latestPayment
    && latestPayment.createdAt >= activeMembership.createdAt,
  );

  if (strictPaymentPolicy && (!activeMembership || !paymentCoversMembership)) {
    throw AppError.badRequest(
      ErrorCode.MEMBERSHIP_EXPIRED_OR_INACTIVE,
      !activeMembership
        ? 'Member does not have an active membership'
        : 'Payment is required before this member can check in',
    );
  }

  const [log_] = await db
    .insert(attendanceLogs)
    .values({
      organizationId: ctx.organizationId,
      branchId: branchId,
      memberId: member.id,
      memberName: `${member.firstName} ${member.lastName}`,
      checkInAt: new Date(),
      checkInMethod: (data.method as any) ?? 'MANUAL',
      checkInBy: ctx.userId,
      notes: data.notes,
    })
    .returning();

  await auditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: AuditAction.ATTENDANCE_CHECKED_IN,
    entityType: 'attendance',
    entityId: log_!.id,
    description: `${member.firstName} ${member.lastName} checked in`,
  });

  log.info({ memberId: member.id, attendanceId: log_!.id }, 'Member checked in');
  return log_;
}

// ── Check-Out ─────────────────────────────────────────────────────────────────

export async function checkOutService(
  ctx: TenantContext,
  data: { memberId: string; notes?: string },
) {
  const [activeSession] = await db
    .select()
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.memberId, data.memberId),
        tenantWhere(attendanceLogs, ctx),
        accessibleBranchesWhere(attendanceLogs, ctx),
        isNull(attendanceLogs.checkOutAt),
      ),
    )
    .orderBy(desc(attendanceLogs.checkInAt))
    .limit(1);

  if (!activeSession) {
    throw AppError.notFound(ErrorCode.NOT_CHECKED_IN, 'Member is not currently checked in');
  }

  const [updated] = await db
    .update(attendanceLogs)
    .set({
      checkOutAt: new Date(),
      checkOutBy: ctx.userId,
      notes: data.notes ?? activeSession.notes,
      updatedAt: new Date(),
    })
    .where(eq(attendanceLogs.id, activeSession.id))
    .returning();

  await auditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: AuditAction.ATTENDANCE_CHECKED_OUT,
    entityType: 'attendance',
    entityId: activeSession.id,
  });

  return updated;
}

// ── Currently Inside ──────────────────────────────────────────────────────────

export async function getCurrentlyInsideService(ctx: TenantContext) {
  const qualifiedColumn = (table: string, column: string) =>
    sql`${sql.identifier(table)}.${sql.identifier(column)}`;

  const items = await db
    .select({
      id: attendanceLogs.id,
      memberId: attendanceLogs.memberId,
      memberName: attendanceLogs.memberName,
      checkInAt: attendanceLogs.checkInAt,
      checkInMethod: attendanceLogs.checkInMethod,
      memberNumber: members.memberNumber,
      firstName: members.firstName,
      lastName: members.lastName,
      planName: sql<string | null>`(
        SELECT ${qualifiedColumn('member_memberships', 'plan_name')}
        FROM ${sql.identifier('member_memberships')}
        WHERE ${qualifiedColumn('member_memberships', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('member_memberships', 'created_at')} DESC
        LIMIT 1
      )`,
      membershipEndDate: sql<string | null>`(
        SELECT ${qualifiedColumn('member_memberships', 'end_date')}
        FROM ${sql.identifier('member_memberships')}
        WHERE ${qualifiedColumn('member_memberships', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('member_memberships', 'created_at')} DESC
        LIMIT 1
      )`,
      membershipStatusRaw: sql<string | null>`(
        SELECT ${qualifiedColumn('member_memberships', 'status')}
        FROM ${sql.identifier('member_memberships')}
        WHERE ${qualifiedColumn('member_memberships', 'member_id')} = ${qualifiedColumn('members', 'id')}
        ORDER BY ${qualifiedColumn('member_memberships', 'created_at')} DESC
        LIMIT 1
      )`,
    })
    .from(attendanceLogs)
    .leftJoin(members, eq(attendanceLogs.memberId, members.id))
    .where(and(tenantWhere(attendanceLogs, ctx), accessibleBranchesWhere(attendanceLogs, ctx), isNull(attendanceLogs.checkOutAt)))
    .orderBy(desc(attendanceLogs.checkInAt));

  return items.map(item => {
    let calculatedMembershipStatus = item.membershipStatusRaw ? String(item.membershipStatusRaw) : 'INACTIVE';
    if (item.planName && calculatedMembershipStatus !== 'EXPIRED' && item.membershipEndDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const exp = new Date(item.membershipEndDate);
      if (exp < today) {
        calculatedMembershipStatus = 'EXPIRED';
      } else {
        const diffTime = exp.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        if (diffDays <= 7) calculatedMembershipStatus = 'EXPIRING';
      }
    }

    return {
      id: item.id,
      memberId: item.memberId,
      memberName: item.memberName,
      checkInAt: item.checkInAt,
      checkInMethod: item.checkInMethod,
      memberNumber: item.memberNumber,
      firstName: item.firstName,
      lastName: item.lastName,
      planName: item.planName,
      membershipStatus: calculatedMembershipStatus,
    };
  });
}

// ── List Attendance ───────────────────────────────────────────────────────────

export async function listAttendanceService(ctx: TenantContext, query: Record<string, unknown>) {
  const { cursor, pageSize } = parseCursorPagination(query);
  const conditions: any[] = [tenantWhere(attendanceLogs, ctx), accessibleBranchesWhere(attendanceLogs, ctx)];

  if (query['date']) {
    const date = query['date'] as string;
    conditions.push(gte(attendanceLogs.checkInAt, istDayStart(date)), lte(attendanceLogs.checkInAt, istDayEnd(date)));
  }

  if (query['memberId']) {
    conditions.push(eq(attendanceLogs.memberId, query['memberId'] as string));
  }

  // Search by member name stored in the log (fast, no join needed)
  if (query['search']) {
    const term = `%${String(query['search']).trim()}%`;
    conditions.push(sql`${attendanceLogs.memberName} ILIKE ${term}`);
  }

  const decodedCursor = decodeCursor<[string, string]>(cursor);
  if (decodedCursor) {
    const [cursorDate, cursorId] = decodedCursor;
    conditions.push(
      or(
        lt(attendanceLogs.checkInAt, new Date(cursorDate)),
        and(eq(attendanceLogs.checkInAt, new Date(cursorDate)), lt(attendanceLogs.id, cursorId))
      )
    );
  }

  const whereClause = and(...conditions);

  const items = await db
    .select()
    .from(attendanceLogs)
    .where(whereClause)
    .orderBy(desc(attendanceLogs.checkInAt), desc(attendanceLogs.id))
    .limit(pageSize + 1);

  return buildCursorPaginatedResponse(items, pageSize, (item) => [
    item.checkInAt.toISOString(),
    item.id,
  ]);
}

// ── Member Attendance History ─────────────────────────────────────────────────


export async function getMemberAttendanceService(ctx: TenantContext, memberId: string, query: Record<string, unknown>) {
  const [member] = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.id, memberId), tenantWhere(members, ctx), accessibleBranchesWhere(members, ctx), isNull(members.deletedAt)))
    .limit(1);
  if (!member) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  const { cursor, pageSize } = parseCursorPagination(query);
  const conditions: any[] = [
    eq(attendanceLogs.memberId, memberId),
    tenantWhere(attendanceLogs, ctx)
  ];

  const decodedCursor = decodeCursor<[string, string]>(cursor);
  if (decodedCursor) {
    const [cursorDate, cursorId] = decodedCursor;
    conditions.push(
      or(
        lt(attendanceLogs.checkInAt, new Date(cursorDate)),
        and(eq(attendanceLogs.checkInAt, new Date(cursorDate)), lt(attendanceLogs.id, cursorId))
      )
    );
  }

  const items = await db
    .select()
    .from(attendanceLogs)
    .where(and(...conditions))
    .orderBy(desc(attendanceLogs.checkInAt), desc(attendanceLogs.id))
    .limit(pageSize + 1);

  return buildCursorPaginatedResponse(items, pageSize, (item) => [
    item.checkInAt.toISOString(),
    item.id,
  ]);
}

// ── Correct Attendance ─────────────────────────────────────────────────────────

export async function correctAttendanceService(
  ctx: TenantContext,
  data: { attendanceId: string; checkInAt?: string; checkOutAt?: string; reason: string },
) {
  const [log_] = await db
    .select()
    .from(attendanceLogs)
    .where(and(
      eq(attendanceLogs.id, data.attendanceId),
      tenantWhere(attendanceLogs, ctx),
      accessibleBranchesWhere(attendanceLogs, ctx)
    ))
    .limit(1);

  if (!log_) throw AppError.notFound(ErrorCode.ATTENDANCE_NOT_FOUND, 'Attendance record not found');

  const updates: any = {
    correctedAt: new Date(),
    correctedBy: ctx.userId,
    correctionReason: data.reason,
    updatedAt: new Date(),
  };
  if (data.checkInAt) updates.checkInAt = new Date(data.checkInAt);
  if (data.checkOutAt) updates.checkOutAt = new Date(data.checkOutAt);

  const [updated] = await db
    .update(attendanceLogs)
    .set(updates)
    .where(eq(attendanceLogs.id, data.attendanceId))
    .returning();

  await auditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: AuditAction.ATTENDANCE_CORRECTED,
    entityType: 'attendance',
    entityId: data.attendanceId,
    beforeState: log_,
    afterState: updated,
    description: data.reason,
  });

  return updated;
}

// ── Analytics: Peak Hours ─────────────────────────────────────────────────────

export async function getPeakHoursService(ctx: TenantContext) {
  const rows = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM check_in_at)`.as('hour'),
      count: count(),
    })
    .from(attendanceLogs)
    .where(and(tenantWhere(attendanceLogs, ctx), accessibleBranchesWhere(attendanceLogs, ctx)))
    .groupBy(sql`EXTRACT(HOUR FROM check_in_at)`)
    .orderBy(sql`EXTRACT(HOUR FROM check_in_at)`);

  return rows.map((r) => ({
    hour: r.hour,
    label: `${r.hour}:00 - ${r.hour + 1}:00`,
    count: r.count,
  }));
}

// ── Analytics: Daily ──────────────────────────────────────────────────────────

export async function getDailyAttendanceService(ctx: TenantContext, days: number = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select({
      date: sql<string>`DATE(check_in_at AT TIME ZONE 'Asia/Kolkata')`.as('date'),
      count: count(),
    })
    .from(attendanceLogs)
    .where(and(
      tenantWhere(attendanceLogs, ctx),
      accessibleBranchesWhere(attendanceLogs, ctx),
      gte(attendanceLogs.checkInAt, since)
    ))
    .groupBy(sql`DATE(check_in_at AT TIME ZONE 'Asia/Kolkata')`)
    .orderBy(sql`DATE(check_in_at AT TIME ZONE 'Asia/Kolkata')`);

  return rows;
}
