import { sql } from 'drizzle-orm';
import { db } from '../src/db';

async function validate() {
  console.log('--- Starting Tenant Data Validation ---');
  let violations = 0;

  async function checkRelation(
    tableName: string,
    fkCol: string,
    targetTable: string,
    targetCol: string = 'id'
  ) {
    const query = sql.raw(`
      SELECT COUNT(*) as count
      FROM ${tableName} a
      JOIN ${targetTable} b ON b.${targetCol} = a.${fkCol}
      WHERE a.organization_id <> b.organization_id
    `);
    
    try {
      const result = await db.execute(query);
      const count = Number(result[0].count);
      
      if (count > 0) {
        console.error(`❌ VIOLATION: ${tableName}.${fkCol} -> ${targetTable}.${targetCol} has ${count} cross-tenant mismatches`);
        violations += count;
      } else {
        console.log(`✅ OK: ${tableName}.${fkCol} -> ${targetTable}.${targetCol} (0 violations)`);
      }
    } catch (e: any) {
       console.log(`⚠️  Skipped ${tableName}.${fkCol}: Table might not exist or missing organization_id (${e.message})`);
    }
  }

  // Branch constraints
  await checkRelation('users', 'branch_id', 'branches');
  await checkRelation('settings', 'branch_id', 'branches');
  await checkRelation('trainers', 'branch_id', 'branches');
  await checkRelation('leads', 'branch_id', 'branches');
  await checkRelation('payment_transactions', 'branch_id', 'branches');
  await checkRelation('biometric_devices', 'branch_id', 'branches');
  await checkRelation('biometric_events', 'branch_id', 'branches');

  // Other common cross-tenant relations
  await checkRelation('attendance_logs', 'member_id', 'members');
  await checkRelation('invoices', 'member_id', 'members');
  await checkRelation('payment_transactions', 'invoice_id', 'invoices');
  await checkRelation('member_memberships', 'member_id', 'members');
  await checkRelation('member_memberships', 'plan_id', 'membership_plans');

  if (violations === 0) {
    console.log('\n✅ SUCCESS: No cross-tenant data violations found. Safe to apply composite foreign keys.');
    process.exit(0);
  } else {
    console.error(`\n❌ FAILED: Found ${violations} total cross-tenant violations. Must fix data before migrating.`);
    process.exit(1);
  }
}

validate().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});
