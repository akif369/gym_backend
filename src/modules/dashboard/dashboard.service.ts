import { and, count, desc, eq, gte, inArray, isNull, lte, sql, sum } from 'drizzle-orm';
import { db } from '../../db/index';
import { attendanceLogs } from '../../db/schema/attendance.schema';
import { leads } from '../../db/schema/leads.schema';
import { members } from '../../db/schema/members.schema';
import { memberMemberships } from '../../db/schema/memberships.schema';
import { paymentTransactions } from '../../db/schema/payments.schema';
import { ptSessions } from '../../db/schema/pt.schema';
import { trainers } from '../../db/schema/trainers.schema';
import { branches } from '../../db/schema/org.schema';
import { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';
import { toISTDateString, istDayStart, istMonthStart } from '../../common/utils/timezone';

const asNumber = (value: string | number | null | undefined) => Number(value ?? 0);

/** Returns midnight of the given date in Asia/Kolkata, expressed as a UTC Date. */
function dayStart(date = new Date()) {
  return istDayStart(toISTDateString(date));
}

function monthStart(date = new Date()) {
  return istMonthStart(date);
}

export async function getDashboardService(ctx: TenantContext) {
  const now = new Date();
  const today = dayStart(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const thisMonth = monthStart(now);
  const sevenDaysFromNow = new Date(today);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  const todayDate = toISTDateString(today);
  const thisMonthDate = `${todayDate.slice(0, 8)}01`;
  const expiryDate = toISTDateString(sevenDaysFromNow);
  const attendanceSince = new Date(today);
  attendanceSince.setDate(attendanceSince.getDate() - 6);
  const revenueSince = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const orgFilter = (table: any) => and(tenantWhere(table, ctx), accessibleBranchesWhere(table, ctx));

  const [
    currentlyInsideRes,
    todaysCheckinsRes,
    todaysRevenueRes,
    monthRevenueRes,
    pendingAmountRes,
    activeMembersRes,
    inactiveMembersRes,
    expiredMembershipsRes,
    newMembersMonthRes,
    trainersWorkingRes,
    totalTrainersRes,
    todaysPtSessionsRes,
    newLeadsRes,
    attendanceRows,
    revenueRows,
    peakRows,
    recentLogs,
    recentPayments,
  ] = await Promise.all([
    db.select({ currentlyInside: count() }).from(attendanceLogs).where(and(orgFilter(attendanceLogs), isNull(attendanceLogs.checkOutAt))),
    db.select({ todaysCheckins: count() }).from(attendanceLogs).where(and(orgFilter(attendanceLogs), gte(attendanceLogs.checkInAt, today), lte(attendanceLogs.checkInAt, tomorrow))),
    db.select({ todaysRevenue: sum(paymentTransactions.totalAmount) }).from(paymentTransactions).where(and(orgFilter(paymentTransactions), eq(paymentTransactions.status, 'PAID'), gte(paymentTransactions.createdAt, today), lte(paymentTransactions.createdAt, tomorrow))),
    db.select({ monthRevenue: sum(paymentTransactions.totalAmount) }).from(paymentTransactions).where(and(orgFilter(paymentTransactions), eq(paymentTransactions.status, 'PAID'), gte(paymentTransactions.createdAt, thisMonth))),
    db.select({ pendingAmount: sum(paymentTransactions.totalAmount) }).from(paymentTransactions).where(and(orgFilter(paymentTransactions), inArray(paymentTransactions.status, ['PENDING', 'PARTIALLY_PAID']))),
    db.select({ activeMembers: count() }).from(members).where(and(
      orgFilter(members),
      isNull(members.deletedAt),
      sql`(SELECT status FROM member_memberships WHERE member_id = ${members.id} ORDER BY created_at DESC LIMIT 1) = 'ACTIVE'`,
    )),
    db.select({ inactiveMembers: count() }).from(members).where(and(orgFilter(members), isNull(members.deletedAt), eq(members.status, 'ARCHIVED'))),
    db.select({ expiredMemberships: count() }).from(members).where(and(
      orgFilter(members),
      isNull(members.deletedAt),
      sql`(SELECT status FROM member_memberships WHERE member_id = ${members.id} ORDER BY created_at DESC LIMIT 1) = 'EXPIRED'`,
    )),
    db.select({ newMembersMonth: count() }).from(members).where(and(orgFilter(members), isNull(members.deletedAt), gte(members.joinDate, thisMonthDate))),
    db.select({ trainersWorking: count() }).from(trainers).where(and(orgFilter(trainers), isNull(trainers.deletedAt), eq(trainers.status, 'ACTIVE'))),
    db.select({ totalTrainers: count() }).from(trainers).where(and(orgFilter(trainers), isNull(trainers.deletedAt))),
    db.select({ todaysPtSessions: count() }).from(ptSessions).where(and(orgFilter(ptSessions), gte(ptSessions.scheduledAt, today), lte(ptSessions.scheduledAt, tomorrow), eq(ptSessions.status, 'UPCOMING'))),
    db.select({ newLeads: count() }).from(leads).where(and(orgFilter(leads), isNull(leads.deletedAt), gte(leads.createdAt, thisMonth))),
    db.select({ checkInAt: attendanceLogs.checkInAt }).from(attendanceLogs).where(and(orgFilter(attendanceLogs), gte(attendanceLogs.checkInAt, attendanceSince))),
    db.select({ createdAt: paymentTransactions.createdAt, totalAmount: paymentTransactions.totalAmount }).from(paymentTransactions).where(and(orgFilter(paymentTransactions), eq(paymentTransactions.status, 'PAID'), gte(paymentTransactions.createdAt, revenueSince))),
    db.select({ checkInAt: attendanceLogs.checkInAt }).from(attendanceLogs).where(and(orgFilter(attendanceLogs), gte(attendanceLogs.checkInAt, today), lte(attendanceLogs.checkInAt, tomorrow))),
    db.select({ id: attendanceLogs.id, memberId: attendanceLogs.memberId, memberName: attendanceLogs.memberName, checkInAt: attendanceLogs.checkInAt, checkOutAt: attendanceLogs.checkOutAt, checkInMethod: attendanceLogs.checkInMethod }).from(attendanceLogs).where(orgFilter(attendanceLogs)).orderBy(desc(attendanceLogs.checkInAt)).limit(6),
    db.select({ id: paymentTransactions.id, memberId: paymentTransactions.memberId, memberName: paymentTransactions.memberName, amount: paymentTransactions.totalAmount, paymentMethod: paymentTransactions.paymentMethod, status: paymentTransactions.status, createdAt: paymentTransactions.createdAt, referenceId: paymentTransactions.referenceId, description: paymentTransactions.description }).from(paymentTransactions).where(orgFilter(paymentTransactions)).orderBy(desc(paymentTransactions.createdAt)).limit(5),
  ]);

  const currentlyInside = currentlyInsideRes[0]?.currentlyInside ?? 0;
  const todaysCheckins = todaysCheckinsRes[0]?.todaysCheckins ?? 0;
  const todaysRevenue = todaysRevenueRes[0]?.todaysRevenue ?? 0;
  const monthRevenue = monthRevenueRes[0]?.monthRevenue ?? 0;
  const pendingAmount = pendingAmountRes[0]?.pendingAmount ?? 0;
  const activeMembers = activeMembersRes[0]?.activeMembers ?? 0;
  const inactiveMembers = inactiveMembersRes[0]?.inactiveMembers ?? 0;
  const expiredMemberships = expiredMembershipsRes[0]?.expiredMemberships ?? 0;
  const newMembersMonth = newMembersMonthRes[0]?.newMembersMonth ?? 0;
  const trainersWorking = trainersWorkingRes[0]?.trainersWorking ?? 0;
  const totalTrainers = totalTrainersRes[0]?.totalTrainers ?? 0;
  const todaysPtSessions = todaysPtSessionsRes[0]?.todaysPtSessions ?? 0;
  const newLeads = newLeadsRes[0]?.newLeads ?? 0;

  const attendanceMap = new Map<string, number>();
  for (let day = 0; day < 7; day += 1) {
    const date = new Date(attendanceSince);
    date.setDate(date.getDate() + day);
    attendanceMap.set(toISTDateString(date), 0);
  }
  attendanceRows.forEach(row => {
    const key = toISTDateString(row.checkInAt);
    if (attendanceMap.has(key)) attendanceMap.set(key, (attendanceMap.get(key) ?? 0) + 1);
  });
  const attendanceChart = [...attendanceMap.entries()].map(([date, count]) => ({ day: new Date(`${date}T00:00:00+05:30`).toLocaleDateString('en-US', { weekday: 'short' }), count }));

  const revenueMap = new Map<string, number>();
  for (let month = 0; month < 6; month += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + month, 1);
    revenueMap.set(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, 0);
  }
  revenueRows.forEach(row => {
    const key = toISTDateString(row.createdAt).slice(0, 7); // YYYY-MM in IST
    revenueMap.set(key, (revenueMap.get(key) ?? 0) + asNumber(row.totalAmount));
  });
  const revenueChart = [...revenueMap.entries()].map(([month, revenue]) => ({ month: new Date(`${month}-01T00:00:00+05:30`).toLocaleDateString('en-US', { month: 'short' }), revenue }));

  const peakMap = new Map<number, number>();
  peakRows.forEach(row => {
    // Get the IST hour for peak analysis
    const istHour = Number(row.checkInAt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false })) % 24;
    peakMap.set(istHour, (peakMap.get(istHour) ?? 0) + 1);
  });
  const peakHours = [...peakMap.entries()].sort(([a], [b]) => a - b).map(([hour, count]) => ({ hour: `${String(hour).padStart(2, '0')}:00`, count }));

  const expiringIn7DaysRes = await db
    .select({ expiringIn7Days: count() })
    .from(memberMemberships)
    .innerJoin(members, eq(memberMemberships.memberId, members.id))
    .where(and(
      orgFilter(members),
      isNull(members.deletedAt),
      eq(memberMemberships.status, 'ACTIVE'),
      gte(memberMemberships.endDate, todayDate),
      lte(memberMemberships.endDate, expiryDate),
    ));

  let branchPerformance: any[] = [];
  if (!ctx.activeBranchId) {
    const allBranches = await db.select().from(branches).where(eq(branches.organizationId, ctx.organizationId));
    branchPerformance = await Promise.all(allBranches.map(async b => {
      const [mRes, rRes, iRes] = await Promise.all([
        db.select({ activeMembers: count() }).from(members).where(and(
          eq(members.organizationId, ctx.organizationId), eq(members.branchId, b.id), isNull(members.deletedAt),
          sql`(SELECT status FROM member_memberships WHERE member_id = ${members.id} ORDER BY created_at DESC LIMIT 1) = 'ACTIVE'`
        )),
        db.select({ monthRevenue: sum(paymentTransactions.totalAmount) }).from(paymentTransactions).where(and(
          eq(paymentTransactions.organizationId, ctx.organizationId), eq(paymentTransactions.branchId, b.id),
          eq(paymentTransactions.status, 'PAID'), gte(paymentTransactions.createdAt, thisMonth)
        )),
        db.select({ currentlyInside: count() }).from(attendanceLogs).where(and(
          eq(attendanceLogs.organizationId, ctx.organizationId), eq(attendanceLogs.branchId, b.id), isNull(attendanceLogs.checkOutAt)
        ))
      ]);
      const cap = b.capacity || 100;
      const inside = Number(iRes[0]?.currentlyInside ?? 0);
      const occupancy = Math.min(Math.round((inside / cap) * 100), 100);
      return {
        id: b.id,
        name: b.name,
        members: Number(mRes[0]?.activeMembers ?? 0),
        revenue: asNumber(rRes[0]?.monthRevenue ?? 0),
        growth: 0,
        occupancy,
        status: b.status,
      };
    }));
    // sort by revenue descending
    branchPerformance.sort((a, b) => b.revenue - a.revenue);
  }

  return {
    stats: {
      todaysCheckins: Number(todaysCheckins), currentlyInside: Number(currentlyInside), todaysRevenue: asNumber(todaysRevenue), monthRevenue: asNumber(monthRevenue), pendingAmount: asNumber(pendingAmount),
      expiringIn7Days: Number(expiringIn7DaysRes[0]?.expiringIn7Days ?? 0), expiredMemberships: Number(expiredMemberships), newMembersMonth: Number(newMembersMonth), activeMembers: Number(activeMembers), inactiveMembers: Number(inactiveMembers), trainersWorking: Number(trainersWorking), totalTrainers: Number(totalTrainers), todaysPtSessions: Number(todaysPtSessions), newLeads: Number(newLeads),
    },
    revenueChart, attendanceChart, peakHours, branchPerformance,
    recentLogs: recentLogs.map(log => ({ ...log, date: toISTDateString(log.checkInAt), checkIn: log.checkInAt.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }), checkOut: log.checkOutAt ? log.checkOutAt.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : null, method: log.checkInMethod })),
    recentPayments: recentPayments.map(payment => ({ ...payment, amount: asNumber(payment.amount), date: toISTDateString(payment.createdAt), method: payment.paymentMethod, refId: payment.referenceId ?? '', plan: payment.description ?? '' })),
  };
}
