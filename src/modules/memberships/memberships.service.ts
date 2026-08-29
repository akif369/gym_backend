import { db } from '../../db/index';
import { membershipPlans, memberMemberships, membershipEvents } from '../../db/schema/memberships.schema';
import { members } from '../../db/schema/members.schema';
import { eq, and, isNull, desc, asc, count, sql, lt, ne, inArray, lte } from 'drizzle-orm';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';
import { parsePagination, paginationToLimitOffset, buildPaginatedResponse } from '../../common/pagination/paginate';
import { auditLog } from '../../common/audit/auditLog';
import { AuditAction } from '../../db/schema/audit.schema';
import { createLogger } from '../../common/logger/index';
import { generateMembershipInvoiceService, getPublicInvoiceService, generateInvoicePdfBuffer } from '../payments/payments.service';
import { sendTextMessage, sendMediaMessage } from '../notifications/notifications.service';
import { getInvoiceSettingsService, getTaxSettingsService, getMemberSettingsService } from '../org/org.service';
import { invoices } from '../../db/schema/payments.schema';
import { organizations, branches } from '../../db/schema/org.schema';
import { recordMemberBiometricAccessIntent } from '../biometrics/biometrics.service';
import { addCalendarDays, dateInTimeZone, formatMembershipDate, localDateFromInput, localMidnightToUtc } from '../../common/utils/membership-time';

const log = createLogger('memberships-service');

function formatAmountForMessage(amount: string): string {
  const numeric = Number(amount);
  return Number.isFinite(numeric)
    ? `₹${numeric.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₹${amount}`;
}

async function getOrganizationTimezone(organizationId: string, tx: any = db): Promise<string> {
  const [organization] = await tx.select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Organization not found');
  // Validate early so an invalid tenant setting cannot create ambiguous access windows.
  new Intl.DateTimeFormat('en-US', { timeZone: organization.timezone });
  return organization.timezone;
}

async function sendRenewalNotification(
  ctx: TenantContext,
  memberId: string,
  membership: typeof memberMemberships.$inferSelect,
  plan: typeof membershipPlans.$inferSelect,
  invoiceAmount?: number,
) {
  const invoice = await generateMembershipInvoiceService(ctx.organizationId, {
    memberId,
    membershipId: membership.id,
    planName: plan.name,
    // Use the final charge entered during renewal (discounts or additional
    // charges), not the catalogue price of the plan.
    price: String(invoiceAmount ?? Number(plan.price)),
    gstPercent: plan.gstPercent,
    notes: membership.notes ?? undefined,
  }, ctx.userId);
  const settings = await getInvoiceSettingsService(ctx.organizationId);
  if (!settings.autoSendOnRenewal) return;

  const [member] = await db.select({ firstName: members.firstName, lastName: members.lastName, phone: members.phone })
    .from(members)
    .where(and(eq(members.id, memberId), tenantWhere(members, ctx), isNull(members.deletedAt)))
    .limit(1);
  if (!member?.phone) return;

  const memberName = `${member.firstName} ${member.lastName}`.trim();
  const text = `Hello ${memberName} 👋

Your *${plan.name}* membership has been renewed successfully ✅

📅 Access expires at 12:00 AM on: *${formatMembershipDate(membership.expiresAt, membership.timezone)}*
💳 Amount: *${formatAmountForMessage(invoice.totalAmount)}*${invoice.taxIncluded ? ' (GST included)' : ''}
🧾 Invoice: *${invoice.invoiceNumber}*

View or download your invoice:
${invoice.publicViewUrl}

Thank you for training with us!`;

  let delivery;
  if (settings.attachInvoicePdf) {
    const publicInvoice = await getPublicInvoiceService(invoice.publicToken);
    const pdfBuffer = await generateInvoicePdfBuffer(publicInvoice);
    delivery = await sendMediaMessage({
      ctx,
      memberId,
      invoiceId: invoice.id,
      eventType: 'MEMBERSHIP_RENEWED',
      phone: member.phone,
      text,
      pdfBuffer,
      filename: `Invoice_${invoice.invoiceNumber}.pdf`,
      idempotencyKey: `membership-renewed:${membership.id}`,
      actorId: ctx.userId,
    });
  } else {
    delivery = await sendTextMessage({
      ctx,
      memberId,
      invoiceId: invoice.id,
      eventType: 'MEMBERSHIP_RENEWED',
      phone: member.phone,
      text,
      idempotencyKey: `membership-renewed:${membership.id}`,
      actorId: ctx.userId,
    });
  }

  if (delivery.status === 'SENT') {
    await db.update(invoices).set({ status: 'SENT', updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
  }
}

// ── Helper: emit membership event ─────────────────────────────────────────────

async function emitEvent(
  ctx: TenantContext,
  membershipId: string | null,
  memberId: string,
  eventType: typeof membershipEvents.$inferInsert['eventType'],
  actorName?: string,
  notes?: string,
  metadata?: unknown,
  tx: any = db,
) {
  await tx.insert(membershipEvents).values({
    organizationId: ctx.organizationId,
    branchId: ctx.activeBranchId,
    membershipId,
    memberId,
    eventType,
    actorId: ctx.userId,
    actorName,
    notes,
    metadata: metadata as any,
  });
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export async function listPlansService(ctx: TenantContext) {
  return db
    .select()
    .from(membershipPlans)
    .where(and(tenantWhere(membershipPlans, ctx), accessibleBranchesWhere(membershipPlans, ctx)))
    .orderBy(asc(membershipPlans.durationDays));
}

export async function createPlanService(ctx: TenantContext, data: Omit<typeof membershipPlans.$inferInsert, 'id' | 'organizationId' | 'branchId' | 'createdAt' | 'updatedAt'>) {
  const [plan] = await db.insert(membershipPlans).values({ ...data, organizationId: ctx.organizationId, branchId: ctx.activeBranchId }).returning();
  log.info({ planId: plan!.id, name: data.name }, 'Membership plan created');
  return plan;
}

export async function getPlanService(ctx: TenantContext, planId: string) {
  const [plan] = await db
    .select()
    .from(membershipPlans)
    .where(and(eq(membershipPlans.id, planId), tenantWhere(membershipPlans, ctx), accessibleBranchesWhere(membershipPlans, ctx)))
    .limit(1);
  if (!plan) throw AppError.notFound(ErrorCode.MEMBERSHIP_PLAN_NOT_FOUND, 'Membership plan not found');
  return plan;
}

export async function updatePlanService(ctx: TenantContext, planId: string, data: Partial<typeof membershipPlans.$inferInsert>) {
  await getPlanService(ctx, planId);
  const [updated] = await db
    .update(membershipPlans)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(membershipPlans.id, planId))
    .returning();
  return updated;
}

export async function updatePlanStatusService(ctx: TenantContext, planId: string, status: 'ACTIVE' | 'INACTIVE') {
  await getPlanService(ctx, planId);
  const [updated] = await db
    .update(membershipPlans)
    .set({ status, updatedAt: new Date() })
    .where(eq(membershipPlans.id, planId))
    .returning({ id: membershipPlans.id, status: membershipPlans.status });
  return updated;
}

export async function deletePlanService(ctx: TenantContext, planId: string) {
  await getPlanService(ctx, planId);

  const [usage] = await db
    .select({ total: count() })
    .from(memberMemberships)
    .where(eq(memberMemberships.planId, planId));

  if (Number(usage?.total ?? 0) > 0) {
    throw AppError.badRequest(
      ErrorCode.BAD_REQUEST,
      'This plan has membership history and cannot be deleted. Set it to inactive instead.',
    );
  }

  await db.delete(membershipPlans)
    .where(and(eq(membershipPlans.id, planId), tenantWhere(membershipPlans, ctx)));
}

// ── Member Memberships ────────────────────────────────────────────────────────

export async function getMemberMembershipsService(ctx: TenantContext, memberId: string) {
  const [member] = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.id, memberId), tenantWhere(members, ctx), isNull(members.deletedAt)))
    .limit(1);
  if (!member) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  return db
    .select()
    .from(memberMemberships)
    .where(and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx), accessibleBranchesWhere(memberMemberships, ctx)))
    .orderBy(desc(memberMemberships.createdAt));
}

export async function getMembershipEventsService(ctx: TenantContext, memberId: string) {
  const [member] = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.id, memberId), tenantWhere(members, ctx), isNull(members.deletedAt)))
    .limit(1);
  if (!member) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  return db
    .select()
    .from(membershipEvents)
    .where(and(eq(membershipEvents.memberId, memberId), tenantWhere(membershipEvents, ctx), accessibleBranchesWhere(membershipEvents, ctx)))
    .orderBy(desc(membershipEvents.createdAt));
}

// ── List All Membership Events (org-wide) ─────────────────────────────────────

export async function listMembershipEventsService(ctx: TenantContext, query: Record<string, unknown>) {
  const { page, pageSize } = parsePagination(query);
  const { limit, offset } = paginationToLimitOffset({ page, pageSize });

  // Join membership events with member data for names
  const totalRes = await db
    .select({ total: count() })
    .from(membershipEvents)
    .innerJoin(members, eq(members.id, membershipEvents.memberId))
    .where(and(tenantWhere(members, ctx), accessibleBranchesWhere(membershipEvents, ctx)));
  const total = totalRes[0]?.total ?? 0;

  const items = await db
    .select({
      id: membershipEvents.id,
      memberId: membershipEvents.memberId,
      membershipId: membershipEvents.membershipId,
      eventType: membershipEvents.eventType,
      actorId: membershipEvents.actorId,
      actorName: membershipEvents.actorName,
      notes: membershipEvents.notes,
      createdAt: membershipEvents.createdAt,
      firstName: members.firstName,
      lastName: members.lastName,
    })
    .from(membershipEvents)
    .innerJoin(members, eq(members.id, membershipEvents.memberId))
    .where(and(tenantWhere(members, ctx), accessibleBranchesWhere(membershipEvents, ctx)))
    .orderBy(desc(membershipEvents.createdAt))
    .limit(limit)
    .offset(offset);

  return buildPaginatedResponse(items, total ?? 0, { page, pageSize });
}

// ── Validate idempotency ──────────────────────────────────────────────────────

async function checkIdempotency(key?: string): Promise<boolean> {
  if (!key) return false;
  const [existing] = await db
    .select({ id: memberMemberships.id })
    .from(memberMemberships)
    .where(eq(memberMemberships.idempotencyKey, key))
    .limit(1);
  return !!existing;
}

// ── Create Membership ─────────────────────────────────────────────────────────

export async function createMembershipService(
  ctx: TenantContext,
  memberId: string,
  data: {
    planId: string;
    /** ISO instant or YYYY-MM-DD; normalized to the gym's local midnight. */
    startAt: string;
    notes?: string;
    idempotencyKey?: string;
  },
  actorName?: string,
) {
  if (data.idempotencyKey && await checkIdempotency(data.idempotencyKey)) {
    throw AppError.conflict(ErrorCode.IDEMPOTENCY_CONFLICT, 'Duplicate request with same idempotency key');
  }

  const plan = await getPlanService(ctx, data.planId);
  if (plan.status === 'INACTIVE') {
    throw AppError.badRequest(ErrorCode.MEMBERSHIP_PLAN_INACTIVE, 'Membership plan is not active');
  }

  const timezone = await getOrganizationTimezone(ctx.organizationId);
  const startDate = localDateFromInput(data.startAt, timezone);
  const startAt = localMidnightToUtc(startDate, timezone);
  const expiresAt = localMidnightToUtc(addCalendarDays(startDate, plan.durationDays), timezone);

  const [membership] = await db
    .insert(memberMemberships)
    .values({
      organizationId: ctx.organizationId,
      branchId: ctx.activeBranchId,
      memberId,
      planId: plan.id,
      planName: plan.name,
      startAt,
      expiresAt,
      timezone,
      status: 'PENDING',
      ptSessionsTotal: plan.ptSessionsIncluded,
      ...(data.notes ? { notes: data.notes } : {}),
      ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {}),
      createdBy: ctx.userId,
    } as any)
    .returning();

  await emitEvent(ctx, membership!.id, memberId, 'CREATED', actorName, data.notes, { plan: { id: plan.id, name: plan.name, durationDays: plan.durationDays } });

  await auditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: AuditAction.MEMBERSHIP_CREATED,
    entityType: 'membership',
    entityId: membership!.id,
    description: `Membership created: ${plan.name}`,
    afterState: membership,
  });

  log.info({ memberId, membershipId: membership!.id, plan: plan.name }, 'Membership created');
  return membership;
}

// ── Activate Membership ───────────────────────────────────────────────────────

export async function activateMembershipService(ctx: TenantContext, memberId: string, actorName?: string) {
  const [membership] = await db
    .select()
    .from(memberMemberships)
    .where(and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx), eq(memberMemberships.status, 'PENDING')))
    .orderBy(desc(memberMemberships.createdAt))
    .limit(1);

  if (!membership) throw AppError.notFound(ErrorCode.MEMBERSHIP_NOT_FOUND, 'No pending membership found');

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(memberMemberships)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(memberMemberships.id, membership.id))
      .returning();
    await tx.update(members).set({ status: 'ACTIVE', updatedAt: new Date() }).where(eq(members.id, memberId));
    await recordMemberBiometricAccessIntent(ctx, memberId, updated!.startAt <= new Date() && updated!.expiresAt > new Date() ? 1 : 99, tx);
    await emitEvent(ctx, membership.id, memberId, 'ACTIVATED', actorName, undefined, undefined, tx);
    await auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_ACTIVATED, entityType: 'membership', entityId: membership.id }, tx);
    return updated;
  });
}

// ── Renew Membership ──────────────────────────────────────────────────────────

export async function renewMembershipService(
  ctx: TenantContext,
  memberId: string,
  data: { planId?: string; notes?: string; invoiceAmount?: number; idempotencyKey?: string },
  actorName?: string,
) {
  const [member] = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.id, memberId), tenantWhere(members, ctx), isNull(members.deletedAt)))
    .limit(1);
  if (!member) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  if (data.idempotencyKey) {
    const [existing] = await db.select({ membership: memberMemberships })
      .from(memberMemberships)
      .innerJoin(members, eq(members.id, memberMemberships.memberId))
      .where(and(
        eq(memberMemberships.idempotencyKey, data.idempotencyKey),
        tenantWhere(members, ctx),
      ))
      .limit(1);
    if (existing) return existing.membership;
  }

  // Read the most recent active membership to choose the renewal plan. The
  // transaction below reads it again before calculating the final boundary.
  const [current] = await db
    .select()
    .from(memberMemberships)
    .where(and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx), eq(memberMemberships.status, 'ACTIVE')))
    .orderBy(desc(memberMemberships.expiresAt))
    .limit(1);

  const planId = data.planId ?? current?.planId;
  if (!planId) throw AppError.badRequest(ErrorCode.MEMBERSHIP_NOT_FOUND, 'No active membership or plan specified');

  const plan = await getPlanService(ctx, planId);
  if (data.invoiceAmount !== undefined && (!Number.isFinite(data.invoiceAmount) || data.invoiceAmount <= 0)) {
    throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Invoice amount must be greater than zero');
  }

  const timezone = await getOrganizationTimezone(ctx.organizationId);

  const membership = await db.transaction(async (tx) => {
    const [lockedCurrent] = await tx.select()
      .from(memberMemberships)
      .where(and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx), eq(memberMemberships.status, 'ACTIVE')))
      .orderBy(desc(memberMemberships.expiresAt))
      .limit(1)
      .for('update');
    const now = new Date();
    const startAt = lockedCurrent && lockedCurrent.expiresAt > now
      ? lockedCurrent.expiresAt
      : localMidnightToUtc(dateInTimeZone(now, timezone), timezone);
    const expiresAt = localMidnightToUtc(addCalendarDays(dateInTimeZone(startAt, timezone), plan.durationDays), timezone);

    const [newMembership] = await tx
      .insert(memberMemberships)
      .values({
        organizationId: ctx.organizationId,
        branchId: lockedCurrent?.branchId ?? ctx.activeBranchId,
        memberId,
        planId: plan.id,
        planName: plan.name,
        startAt,
        expiresAt,
        timezone,
        status: 'ACTIVE',
        ptSessionsTotal: plan.ptSessionsIncluded,
        ...(data.notes ? { notes: data.notes } : {}),
        ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {}),
        createdBy: ctx.userId,
      } as any)
      .returning();

    // Preserve an unexpired old row until its exclusive boundary. This avoids
    // a renewal creating a gap before the new membership starts.
    if (lockedCurrent && lockedCurrent.expiresAt <= now) {
      await tx.update(memberMemberships).set({ status: 'EXPIRED', updatedAt: now }).where(eq(memberMemberships.id, lockedCurrent.id));
    }

    // Ensure member is active
    await tx.update(members).set({ status: 'ACTIVE', updatedAt: new Date() }).where(eq(members.id, memberId));
    await recordMemberBiometricAccessIntent(ctx, memberId, 1, tx);

    await emitEvent(ctx, newMembership!.id, memberId, 'RENEWED', actorName, data.notes, { plan: { name: plan.name } }, tx);
    await auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_RENEWED, entityType: 'membership', entityId: newMembership!.id }, tx);
    
    return newMembership;
  });

  sendRenewalNotification(ctx, memberId, membership!, plan, data.invoiceAmount)
    .catch((error) => {
      // A provider outage must not undo a completed membership renewal.
      log.error({ err: error, memberId, membershipId: membership!.id }, 'Renewal notification workflow failed');
    });
  return membership;
}

export async function expireDueMembershipsService() {
  const expiredMemberships = await db.transaction(async (tx) => {
    // 1002 is a unique ID for the expiry sweep
    const result = await tx.execute<{ pg_try_advisory_xact_lock: boolean }>(sql`SELECT pg_try_advisory_xact_lock(1002)`);
    if (!result[0]?.pg_try_advisory_xact_lock) return [];

    const candidates = await tx.select({
      membership: memberMemberships,
      organizationId: members.organizationId,
      firstName: members.firstName,
      lastName: members.lastName,
      phone: members.phone,
    })
      .from(memberMemberships)
      .innerJoin(members, eq(members.id, memberMemberships.memberId))
      .where(and(
        eq(memberMemberships.status, 'ACTIVE'),
        isNull(members.deletedAt),
        sql`${memberMemberships.expiresAt} <= NOW()`,
      ))
      .orderBy(asc(memberMemberships.expiresAt))
      .limit(500)
      .for('update', { skipLocked: true });

    const newlyExpired = [];
    for (const candidate of candidates) {
      const [updated] = await tx.update(memberMemberships)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(
          eq(memberMemberships.id, candidate.membership.id),
          eq(memberMemberships.status, 'ACTIVE'),
          sql`${memberMemberships.expiresAt} <= NOW()`,
        ))
        .returning();
      if (!updated) continue;

      // A pre-renewal may already have created the next membership starting at
      // this exact boundary. Do not briefly deny the member in that case.
      const [stillEligible] = await tx.select({ id: memberMemberships.id })
        .from(memberMemberships)
        .where(and(
          eq(memberMemberships.memberId, updated.memberId),
          eq(memberMemberships.status, 'ACTIVE'),
          sql`${memberMemberships.startAt} <= NOW()`,
          sql`${memberMemberships.expiresAt} > NOW()`,
        ))
        .limit(1);
      await recordMemberBiometricAccessIntent({ organizationId: candidate.organizationId } as TenantContext, updated.memberId, stillEligible ? 1 : 99, tx);

      await auditLog({
        organizationId: candidate.organizationId,
        action: AuditAction.MEMBERSHIP_EXPIRED,
        entityType: 'membership',
        entityId: updated.id,
        description: `Membership expired at ${updated.expiresAt.toISOString()}`,
      }, tx);
      
      newlyExpired.push({ candidate, updated });
    }
    
    return newlyExpired;
  });

  let expired = expiredMemberships.length;
  let notified = 0;

  for (const { candidate, updated } of expiredMemberships) {
    if (!candidate.phone) continue;
    try {
      const memberName = `${candidate.firstName} ${candidate.lastName}`.trim();
      const delivery = await sendTextMessage({
        ctx: { organizationId: candidate.organizationId } as any,
        memberId: updated.memberId,
        eventType: 'MEMBERSHIP_EXPIRED',
        phone: candidate.phone,
        text: `Hello ${memberName} 👋\n\nYour *${updated.planName}* membership expired at 12:00 AM on *${formatMembershipDate(updated.expiresAt, updated.timezone)}*.\n\nRenew now to continue uninterrupted access to the gym and your training plan. Please contact us and we’ll be happy to help. 💪`,
        idempotencyKey: `membership-expired:${updated.id}`,
      });
      if (delivery.status === 'SENT') notified += 1;
    } catch (error) {
      log.error({ err: error, membershipId: updated.id }, 'Expiry notification workflow failed');
    }
  }
  return { expired, notified };
}

export async function sweepInactiveMembersService() {
  return await db.transaction(async (tx) => {
    // 1003 is a unique ID for the inactivity sweep
    const result = await tx.execute<{ pg_try_advisory_xact_lock: boolean }>(sql`SELECT pg_try_advisory_xact_lock(1003)`);
    if (!result[0]?.pg_try_advisory_xact_lock) return { inactiveMarked: 0 };

    const allBranches = await tx.select({ id: branches.id, organizationId: branches.organizationId }).from(branches);
    const orgs = await tx.select({ id: organizations.id, timezone: organizations.timezone }).from(organizations);
    
    const orgTzMap = new Map<string, string>();
    for (const o of orgs) orgTzMap.set(o.id, o.timezone);

    const sweepTargets = [
      ...allBranches.map(b => ({ orgId: b.organizationId, branchId: b.id, timezone: orgTzMap.get(b.organizationId)! })),
      ...orgs.map(o => ({ orgId: o.id, branchId: null, timezone: o.timezone }))
    ];
    
    let inactiveMarked = 0;
    for (const target of sweepTargets) {
      const settings = await getMemberSettingsService(target.orgId, target.branchId);
      const daysBeforeInactive = settings.daysBeforeInactive;
      
      const cutoffString = addCalendarDays(dateInTimeZone(new Date(), target.timezone), -daysBeforeInactive);
      const cutoffAt = localMidnightToUtc(cutoffString, target.timezone);

      // Find members for this target (branch or org fallback) who are not ARCHIVED
      const sweepCandidates = await tx
        .select({ id: members.id, status: members.status })
        .from(members)
        .where(and(
          eq(members.organizationId, target.orgId),
          target.branchId ? eq(members.branchId, target.branchId) : isNull(members.branchId),
          ne(members.status, 'ARCHIVED'),
          isNull(members.deletedAt)
        ));

      if (sweepCandidates.length === 0) continue;

      // Batch fetch all memberships to eliminate N+1 queries (production grade)
      const candidateIds = sweepCandidates.map(m => m.id);
      const allPlans = await tx
        .select({ memberId: memberMemberships.memberId, status: memberMemberships.status, expiresAt: memberMemberships.expiresAt })
        .from(memberMemberships)
        .where(inArray(memberMemberships.memberId, candidateIds));

      // Group memberships in memory by memberId
      const plansByMember = new Map<string, typeof allPlans>();
      for (const plan of allPlans) {
        if (!plansByMember.has(plan.memberId)) plansByMember.set(plan.memberId, []);
        plansByMember.get(plan.memberId)!.push(plan);
      }

      for (const member of sweepCandidates) {
        // Get plans for this member and sort descending by their exclusive expiry.
        const memberPlans = plansByMember.get(member.id) || [];
        memberPlans.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime());

        const hasActive = memberPlans.some(p => p.status === 'ACTIVE' || p.status === 'FROZEN');
        const latestPlan = memberPlans[0];
        
        let shouldBeInactive = false;
        if (!hasActive && latestPlan && ['EXPIRED', 'CANCELLED'].includes(latestPlan.status) && latestPlan.expiresAt < cutoffAt) {
          shouldBeInactive = true;
        }

        if (shouldBeInactive && member.status !== 'INACTIVE') {
          // Mark member as INACTIVE (Manual account status lifecycle respects not reverting)
          await tx.update(members)
            .set({ status: 'INACTIVE', updatedAt: new Date() })
            .where(eq(members.id, member.id));
          inactiveMarked += 1;
          
          await auditLog({
            organizationId: target.orgId,
            action: AuditAction.MEMBER_UPDATED,
            entityType: 'member',
            entityId: member.id,
            description: `Member status updated to INACTIVE due to ${daysBeforeInactive} days of expiry`,
          }, tx);

          await recordMemberBiometricAccessIntent({ organizationId: target.orgId } as TenantContext, member.id, 99, tx);
        }
      }
    }
    return { inactiveMarked };
  });
}

// ── Freeze Membership ─────────────────────────────────────────────────────────

export async function freezeMembershipService(
  ctx: TenantContext,
  memberId: string,
  data: { freezeStart: string; freezeEnd: string; reason?: string },
  actorName?: string,
) {
  const [membership] = await db
    .select()
    .from(memberMemberships)
    .where(and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx), eq(memberMemberships.status, 'ACTIVE')))
    .limit(1);

  if (!membership) throw AppError.notFound(ErrorCode.MEMBERSHIP_NOT_ACTIVE, 'No active membership to freeze');

  const freezeDays = Math.max(0, Math.round(
    (Date.parse(`${data.freezeEnd}T00:00:00Z`) - Date.parse(`${data.freezeStart}T00:00:00Z`)) / (1000 * 60 * 60 * 24),
  ));

  // Preserve calendar-day duration using the membership's original timezone.
  const newExpiresAt = localMidnightToUtc(
    addCalendarDays(dateInTimeZone(membership.expiresAt, membership.timezone), freezeDays),
    membership.timezone,
  );

  const updated = await db.transaction(async (tx) => {
    const [res] = await tx
      .update(memberMemberships)
      .set({
        status: 'FROZEN',
        freezeStartDate: data.freezeStart,
        freezeEndDate: data.freezeEnd,
        frozenDays: membership.frozenDays + freezeDays,
        expiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(memberMemberships.id, membership.id))
      .returning();

    await emitEvent(ctx, membership.id, memberId, 'FROZEN', actorName, data.reason, { freezeStart: data.freezeStart, freezeEnd: data.freezeEnd, freezeDays }, tx);
    await auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_FROZEN, entityType: 'membership', entityId: membership.id }, tx);
    await recordMemberBiometricAccessIntent(ctx, memberId, 99, tx);
    
    return res;
  });

  return updated;
}

// ── Resume Membership ─────────────────────────────────────────────────────────

export async function resumeMembershipService(ctx: TenantContext, memberId: string, actorName?: string) {
  const [membership] = await db
    .select()
    .from(memberMemberships)
    .where(and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx), eq(memberMemberships.status, 'FROZEN')))
    .limit(1);

  if (!membership) throw AppError.notFound(ErrorCode.MEMBERSHIP_NOT_FROZEN, 'No frozen membership found');

  const updated = await db.transaction(async (tx) => {
    const [res] = await tx
      .update(memberMemberships)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(memberMemberships.id, membership.id))
      .returning();

    await emitEvent(ctx, membership.id, memberId, 'RESUMED', actorName, undefined, undefined, tx);
    await auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_RESUMED, entityType: 'membership', entityId: membership.id }, tx);
    await recordMemberBiometricAccessIntent(ctx, memberId, res!.expiresAt > new Date() ? 1 : 99, tx);
    
    return res;
  });

  return updated;
}

// ── Cancel Membership ─────────────────────────────────────────────────────────

export async function cancelMembershipService(ctx: TenantContext, memberId: string, reason: string, actorName?: string) {
  const [membership] = await db
    .select()
    .from(memberMemberships)
    .where(and(
      eq(memberMemberships.memberId, memberId),
      tenantWhere(memberMemberships, ctx),
      // Can cancel ACTIVE or PENDING
    ))
    .orderBy(desc(memberMemberships.createdAt))
    .limit(1);

  if (!membership || !['ACTIVE', 'PENDING'].includes(membership.status)) {
    throw AppError.notFound(ErrorCode.MEMBERSHIP_NOT_FOUND, 'No cancellable membership found');
  }

  const updated = await db.transaction(async (tx) => {
    const [res] = await tx
      .update(memberMemberships)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(memberMemberships.id, membership.id))
      .returning();

    await emitEvent(ctx, membership.id, memberId, 'CANCELLED', actorName, reason, undefined, tx);
    await auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_CANCELLED, entityType: 'membership', entityId: membership.id, description: reason }, tx);
    await recordMemberBiometricAccessIntent(ctx, memberId, 99, tx);
    
    return res;
  });

  return updated;
}

// ── Extend Membership ─────────────────────────────────────────────────────────

export async function extendMembershipService(ctx: TenantContext, memberId: string, days: number, reason: string, actorName?: string) {
  const [membership] = await db
    .select()
    .from(memberMemberships)
    .where(and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx), eq(memberMemberships.status, 'ACTIVE')))
    .limit(1);

  if (!membership) throw AppError.notFound(ErrorCode.MEMBERSHIP_NOT_ACTIVE, 'No active membership to extend');

  if (!Number.isInteger(days) || days <= 0) throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Extension days must be a positive integer');
  const newExpiresAt = localMidnightToUtc(
    addCalendarDays(dateInTimeZone(membership.expiresAt, membership.timezone), days),
    membership.timezone,
  );

  const updated = await db.transaction(async (tx) => {
    const [res] = await tx
      .update(memberMemberships)
      .set({ expiresAt: newExpiresAt, updatedAt: new Date() })
      .where(eq(memberMemberships.id, membership.id))
      .returning();

    await emitEvent(ctx, membership.id, memberId, 'EXTENDED', actorName, reason, { extendedBy: days }, tx);
    await auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_EXTENDED, entityType: 'membership', entityId: membership.id, description: `Extended by ${days} days` }, tx);
    await recordMemberBiometricAccessIntent(ctx, memberId, 1, tx);
    
    return res;
  });

  return updated;
}
