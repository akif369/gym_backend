const fs = require('fs');

let service = fs.readFileSync('src/modules/dashboard/dashboard.service.ts', 'utf8');

service = service.replace(/if \(\!branchId\) \{/g, 'if (!ctx.activeBranchId) {');
service = service.replace(/eq\(branches\.organizationId, orgId\)/g, 'eq(branches.organizationId, ctx.organizationId)');
service = service.replace(/eq\(members\.organizationId, orgId\)/g, 'eq(members.organizationId, ctx.organizationId)');
service = service.replace(/eq\(paymentTransactions\.organizationId, orgId\)/g, 'eq(paymentTransactions.organizationId, ctx.organizationId)');
service = service.replace(/eq\(attendanceLogs\.organizationId, orgId\)/g, 'eq(attendanceLogs.organizationId, ctx.organizationId)');

fs.writeFileSync('src/modules/dashboard/dashboard.service.ts', service);
console.log('Fixed vars');
