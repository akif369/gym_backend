import { eq, and, inArray, SQL, sql } from 'drizzle-orm';
import { AppError, ErrorCode } from '../errors/AppError';

export type OrganizationMode = 'SINGLE_GYM' | 'MULTI_GYM';

export interface TenantContext {
  organizationId: string;
  userId: string;
  activeBranchId: string | null;
  accessibleBranchIds: string[];
  role: string;
  permissions: string[];
  organizationMode: OrganizationMode;
}

/**
 * Returns a Drizzle ORM condition for all records belonging to the organization.
 */
export function tenantWhere(table: any, ctx: TenantContext): SQL {
  return eq(table.organizationId, ctx.organizationId);
}

/**
 * Returns a Drizzle ORM condition for records belonging to the active branch.
 */
export function branchWhere(table: any, ctx: TenantContext): SQL {
  if (!ctx.activeBranchId) {
    // If there is no active branch (e.g. platform admin, or user hasn't selected one), 
    // it's up to business logic if we allow fallback or strict deny. 
    // Usually, branchWhere requires an active branch.
    throw AppError.forbidden(ErrorCode.FORBIDDEN, 'No active branch selected');
  }
  return and(
    eq(table.organizationId, ctx.organizationId),
    eq(table.branchId, ctx.activeBranchId)
  )!;
}

/**
 * Returns a Drizzle ORM condition for records from branches the user is allowed to access.
 */
export function accessibleBranchesWhere(table: any, ctx: TenantContext): SQL {
  if (ctx.accessibleBranchIds.length === 0) {
     // Ensure query returns no rows rather than breaking SQL
     return sql`1=0`;
  }
  return and(
    eq(table.organizationId, ctx.organizationId),
    inArray(table.branchId, ctx.accessibleBranchIds)
  )!;
}

/**
 * Asserts that the requested branch ID is accessible to the current user.
 * Throws 403 Forbidden if not.
 */
export function assertBranchAccess(ctx: TenantContext, branchId: string): void {
  if (!ctx.accessibleBranchIds.includes(branchId)) {
    throw AppError.forbidden(ErrorCode.FORBIDDEN, 'You do not have access to this branch');
  }
}
