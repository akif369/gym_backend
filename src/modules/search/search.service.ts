import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { members } from '../../db/schema/members.schema';
import { paymentTransactions } from '../../db/schema/payments.schema';

const MAX_RESULTS_PER_TYPE = 5;

function canView(permissions: string[], role: string, permission: string) {
  return role === 'OWNER' || permissions.includes('*') || permissions.includes(permission);
}

function likeTerm(query: string) {
  // Escape LIKE wildcards so user input is always treated as text.
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

export async function globalSearchService(
  orgId: string,
  query: string,
  user: { role: string; permissions: string[]; branchId?: string | null },
) {
  const isGlobal = ['OWNER', 'ORGANIZATION_OWNER'].includes(user.role);
  const term = query.trim().slice(0, 100);
  if (term.length < 2) return { members: [], payments: [] };

  const pattern = likeTerm(term);
  const [memberResults, paymentResults] = await Promise.all([
    canView(user.permissions, user.role, 'member.view')
      ? db.select({
        id: members.id,
        memberNumber: members.memberNumber,
        firstName: members.firstName,
        lastName: members.lastName,
        phone: members.phone,
        status: sql<string>`COALESCE((
          SELECT status::text
          FROM member_memberships
          WHERE member_memberships.member_id = members.id
          ORDER BY created_at DESC
          LIMIT 1
        ), members.status::text)`,
      })
        .from(members)
        .where(and(
          eq(members.organizationId, orgId),
          isNull(members.deletedAt),
          !isGlobal && user.branchId ? eq(members.branchId, user.branchId) : undefined,
          or(
            ilike(members.firstName, pattern),
            ilike(members.lastName, pattern),
            ilike(members.memberNumber, pattern),
            ilike(members.phone, pattern),
            ilike(members.email!, pattern),
          ),
        ))
        .orderBy(sql`CASE WHEN ${members.memberNumber} ILIKE ${term} THEN 0 ELSE 1 END`, desc(members.createdAt))
        .limit(MAX_RESULTS_PER_TYPE)
      : Promise.resolve([]),
    canView(user.permissions, user.role, 'payment.view')
      ? db.select({
        id: paymentTransactions.id,
        memberId: paymentTransactions.memberId,
        memberName: paymentTransactions.memberName,
        referenceId: paymentTransactions.referenceId,
        amount: paymentTransactions.totalAmount,
        status: paymentTransactions.status,
        createdAt: paymentTransactions.createdAt,
      })
        .from(paymentTransactions)
        .where(and(
          eq(paymentTransactions.organizationId, orgId),
          !isGlobal && user.branchId ? eq(paymentTransactions.branchId, user.branchId) : undefined,
          or(
            ilike(paymentTransactions.referenceId!, pattern),
            ilike(paymentTransactions.memberName!, pattern),
            ilike(paymentTransactions.description!, pattern),
            sql`CAST(${paymentTransactions.id} AS TEXT) ILIKE ${pattern}`,
          ),
        ))
        .orderBy(desc(paymentTransactions.createdAt))
        .limit(MAX_RESULTS_PER_TYPE)
      : Promise.resolve([]),
  ]);

  return { members: memberResults, payments: paymentResults };
}
