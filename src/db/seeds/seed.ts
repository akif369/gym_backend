/**
 * GYMatrix — Database Seed
 *
 * Seeds:
 *  1. Organization: IronZone Fitness
 *  2. Branch: Main Branch - Koramangala
 *  3. Admin user: admin@ironzone.com / Admin@123
 *  4. System roles with default permissions
 *  5. Staff members (Manager + Receptionist)
 *  6. Membership plans (5 plans)
 *  7. Trainers (3 trainers)
 *  8. Members (5 members) with emergency contacts & health profiles
 *  9. Memberships for each member
 * 10. Sample attendance logs
 * 11. Sample payments
 * 12. Sample PT packages + sessions
 * 13. Leads (5 sample leads)
 * 14. Exercise library (10 exercises)
 * 15. Workout templates
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { db } from '../index';
import {
  organizations, branches, settings,
  users,
  roles, userPermissions,
  members, memberEmergencyContacts, memberHealthProfiles,
  membershipPlans, memberMemberships, membershipEvents,
  attendanceLogs,
  paymentTransactions,
  trainers, trainerAssignments,
  ptPackages, ptSessions,
  leads, leadActivities,
  exercises, workoutTemplates, workoutTemplateExercises,
} from '../schema/index';
import { DEFAULT_ROLE_PERMISSIONS } from '../schema/rbac.schema';
import * as argon2 from 'argon2';
import { addDays, subDays, subHours } from 'date-fns';
import { createLogger } from '../../common/logger/index';

const log = createLogger('seed');

async function hashPw(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
}

async function seed() {
  log.info('Starting database seed...');

  // ── 1. Organization ────────────────────────────────────────────────────────
  log.info('Seeding organization...');
  const [org] = await db.insert(organizations).values({
    name: 'IronZone Fitness',
    slug: 'ironzone-fitness',
    email: 'admin@ironzone.com',
    phone: '080-12345678',
    address: '42, 5th Cross, Koramangala',
    city: 'Bangalore',
    state: 'Karnataka',
    country: 'India',
    gstNumber: '29AAACI1234N1Z5',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
  }).returning();

  // ── 2. Branches ────────────────────────────────────────────────────────────
  log.info('Seeding branches...');
  const [branch1] = await db.insert(branches).values({
    organizationId: org!.id, name: 'Koramangala Branch', address: '42, 5th Cross, Koramangala', city: 'Bangalore', phone: '080-12345678', capacity: 150, status: 'ACTIVE', isMainBranch: true,
  }).returning();
  const [branch2] = await db.insert(branches).values({
    organizationId: org!.id, name: 'Indiranagar Branch', address: '100 Feet Road, Indiranagar', city: 'Bangalore', phone: '080-87654321', capacity: 200, status: 'ACTIVE', isMainBranch: false,
  }).returning();
  const [branch3] = await db.insert(branches).values({
    organizationId: org!.id, name: 'HSR Layout Branch', address: '27th Main Road, HSR', city: 'Bangalore', phone: '080-11223344', capacity: 100, status: 'ACTIVE', isMainBranch: false,
  }).returning();
  
  const allBranches = [branch1!, branch2!, branch3!];

  // ── 3. Settings ────────────────────────────────────────────────────────────
  await db.insert(settings).values({
    organizationId: org!.id,
    category: 'gym-profile',
    value: { name: 'IronZone Fitness', tagline: 'Stronger Every Day', openingHours: '5:30 AM - 10:30 PM' },
  });
  await db.insert(settings).values({
    organizationId: org!.id,
    category: 'tax',
    value: { gstEnabled: true, gstPercent: 18, gstNumber: '29AAACI1234N1Z5' },
  });
  await db.insert(settings).values({
    organizationId: org!.id,
    category: 'invoice',
    value: { prefix: 'GYM', footer: 'Thank you for choosing IronZone Fitness!' },
  });
  await db.insert(settings).values({
    organizationId: org!.id,
    category: 'attendance',
    value: { requireActiveMembership: true, allowEarlyCheckout: false, maxSessionHours: 4 },
  });
  await db.insert(settings).values({
    organizationId: org!.id,
    category: 'hardware',
    value: { qrEnabled: false, rfidEnabled: false, printerEnabled: false },
  });

  // ── 4. System Roles ────────────────────────────────────────────────────────
  log.info('Seeding roles...');
  for (const [key, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    await db.insert(roles).values({
      organizationId: org!.id,
      key,
      name: key.charAt(0) + key.slice(1).toLowerCase(),
      description: `Default ${key.toLowerCase()} role`,
      permissions: perms,
      isSystem: true,
    });
  }

  // ── 5. Admin User ──────────────────────────────────────────────────────────
  log.info('Seeding admin user...');
  const adminHash = await hashPw('Admin@123');
  const [admin] = await db.insert(users).values({
    organizationId: org!.id, branchId: branch1!.id, email: 'admin@ironzone.com', passwordHash: adminHash, role: 'OWNER', firstName: 'Admin', lastName: 'GYMatrix', phone: '9900000001', status: 'ACTIVE',
  }).returning();

  // Manager
  const managerHash = await hashPw('Manager@123');
  const [manager] = await db.insert(users).values({
    organizationId: org!.id, branchId: branch2!.id, email: 'priya.k@ironzone.com', passwordHash: managerHash, role: 'MANAGER', firstName: 'Priya', lastName: 'Kapoor', phone: '9900112233', status: 'ACTIVE',
  }).returning();

  // Receptionist
  const recepHash = await hashPw('Staff@123');
  await db.insert(users).values({
    organizationId: org!.id, branchId: branch3!.id, email: 'suresh.b@ironzone.com', passwordHash: recepHash, role: 'RECEPTIONIST', firstName: 'Suresh', lastName: 'Babu', phone: '9900112244', status: 'ACTIVE',
  });

  // Branch Owner
  const boHash = await hashPw('Owner@123');
  await db.insert(users).values({
    organizationId: org!.id, branchId: branch1!.id, email: 'kora.owner@ironzone.com', passwordHash: boHash, role: 'BRANCH_OWNER', firstName: 'Koramangala', lastName: 'Owner', phone: '9900112255', status: 'ACTIVE',
  });

  // Sales Staff
  const salesHash = await hashPw('Sales@123');
  await db.insert(users).values({
    organizationId: org!.id, branchId: branch2!.id, email: 'sales@ironzone.com', passwordHash: salesHash, role: 'SALES_STAFF', firstName: 'Neha', lastName: 'Sales', phone: '9900112266', status: 'ACTIVE',
  });

  // Accountant
  const accHash = await hashPw('Accountant@123');
  await db.insert(users).values({
    organizationId: org!.id, branchId: branch3!.id, email: 'accounts@ironzone.com', passwordHash: accHash, role: 'ACCOUNTANT', firstName: 'Raj', lastName: 'Finance', phone: '9900112277', status: 'ACTIVE',
  });

  // ── 6. Membership Plans ────────────────────────────────────────────────────
  log.info('Seeding membership plans...');
  const [plan1] = await db.insert(membershipPlans).values({ organizationId: org!.id, name: 'Monthly Basic', durationDays: 30, price: '1500', gstPercent: '18', joiningFee: '500', ptSessionsIncluded: 0, status: 'ACTIVE' }).returning();
  const [plan2] = await db.insert(membershipPlans).values({ organizationId: org!.id, name: 'Monthly Pro', durationDays: 30, price: '2500', gstPercent: '18', joiningFee: '500', ptSessionsIncluded: 2, status: 'ACTIVE' }).returning();
  const [plan3] = await db.insert(membershipPlans).values({ organizationId: org!.id, name: 'Quarterly Gold', durationDays: 90, price: '6500', gstPercent: '18', joiningFee: '0', ptSessionsIncluded: 6, status: 'ACTIVE' }).returning();
  const [plan4] = await db.insert(membershipPlans).values({ organizationId: org!.id, name: 'Half-Yearly Elite', durationDays: 180, price: '11000', gstPercent: '18', joiningFee: '0', ptSessionsIncluded: 15, status: 'ACTIVE' }).returning();
  const [plan5] = await db.insert(membershipPlans).values({ organizationId: org!.id, name: 'Yearly Platinum', durationDays: 365, price: '18000', gstPercent: '18', joiningFee: '0', ptSessionsIncluded: 36, status: 'ACTIVE' }).returning();

  // ── 7. Trainers ────────────────────────────────────────────────────────────
  log.info('Seeding trainers...');
  const [trainer1] = await db.insert(trainers).values({ organizationId: org!.id, branchId: branch1!.id, name: 'Amit Singh', phone: '9988776655', specialization: 'Strength & Conditioning', certifications: 'ACE CPT, ISSA', shift: 'Morning (6AM - 2PM)', status: 'ACTIVE', joiningDate: '2022-06-01' }).returning();
  const [trainer2] = await db.insert(trainers).values({ organizationId: org!.id, branchId: branch2!.id, name: 'Neha Gupta', phone: '9988776644', specialization: 'Yoga & Flexibility', certifications: 'RYT 500, ACE', shift: 'Evening (2PM - 10PM)', status: 'ACTIVE', joiningDate: '2023-01-15' }).returning();
  const [trainer3] = await db.insert(trainers).values({ organizationId: org!.id, branchId: branch3!.id, name: 'Ravi Kumar', phone: '9988776633', specialization: 'CrossFit & Cardio', certifications: 'NASM CPT, CF-L1', shift: 'Morning (6AM - 2PM)', status: 'ON_LEAVE', joiningDate: '2021-09-01' }).returning();

  const trainerHash = await hashPw('Trainer@123');
  await db.insert(users).values({ organizationId: org!.id, branchId: branch1!.id, email: 'amit.trainer@ironzone.com', passwordHash: trainerHash, role: 'TRAINER', firstName: 'Amit', lastName: 'Singh', phone: '9988776655', status: 'ACTIVE' });
  await db.insert(users).values({ organizationId: org!.id, branchId: branch2!.id, email: 'neha.trainer@ironzone.com', passwordHash: trainerHash, role: 'TRAINER', firstName: 'Neha', lastName: 'Gupta', phone: '9988776644', status: 'ACTIVE' });
  await db.insert(users).values({ organizationId: org!.id, branchId: branch3!.id, email: 'ravi.trainer@ironzone.com', passwordHash: trainerHash, role: 'TRAINER', firstName: 'Ravi', lastName: 'Kumar', phone: '9988776633', status: 'ACTIVE' });

  // ── 8. Members ────────────────────────────────────────────────────────────
  log.info('Seeding members...');
  const today = new Date();
  const memberData = [
    { firstName: 'Rahul', lastName: 'Sharma', email: 'rahul.sharma@email.com', phone: '9876543210', gender: 'MALE' as const, dob: '1995-03-10', address: '42, 5th Cross, Koramangala', goal: 'Weight Loss', experienceLevel: 'INTERMEDIATE' as const, joinDate: '2025-01-15', emergency: { name: 'Priya Sharma', phone: '9876543211', relation: 'Wife' }, health: { medicalConditions: 'None', allergies: 'None', injuries: 'Left knee - mild' } },
    { firstName: 'Priya', lastName: 'Mehta', email: 'priya.mehta@email.com', phone: '9876543221', gender: 'FEMALE' as const, dob: '1998-07-22', address: '11, 2nd Main, HSR Layout', goal: 'Muscle Gain', experienceLevel: 'BEGINNER' as const, joinDate: '2025-03-20', emergency: { name: 'Rajan Mehta', phone: '9876543222', relation: 'Father' }, health: { medicalConditions: 'Asthma', allergies: 'Peanuts', injuries: 'None' } },
    { firstName: 'Arjun', lastName: 'Verma', email: 'arjun.v@email.com', phone: '9876543231', gender: 'MALE' as const, dob: '1990-12-05', address: '78, 8th Block, Koramangala', goal: 'Strength', experienceLevel: 'ADVANCED' as const, joinDate: '2024-11-10', emergency: { name: 'Sunita Verma', phone: '9876543232', relation: 'Mother' }, health: { medicalConditions: 'None', allergies: 'None', injuries: 'None' } },
    { firstName: 'Kavya', lastName: 'Reddy', email: 'kavya.r@email.com', phone: '9876543241', gender: 'FEMALE' as const, dob: '2000-04-18', address: '25, 3rd Main, Indiranagar', goal: 'Flexibility', experienceLevel: 'BEGINNER' as const, joinDate: '2026-01-05', emergency: { name: 'Ravi Reddy', phone: '9876543242', relation: 'Father' }, health: { medicalConditions: 'None', allergies: 'None', injuries: 'None' } },
    { firstName: 'Vikram', lastName: 'Nair', email: 'vikram.n@email.com', phone: '9876543251', gender: 'MALE' as const, dob: '1988-09-30', address: '56, 7th Sector, HSR Layout', goal: 'Endurance', experienceLevel: 'INTERMEDIATE' as const, joinDate: '2025-08-15', emergency: { name: 'Latha Nair', phone: '9876543252', relation: 'Spouse' }, health: { medicalConditions: 'Hypertension', allergies: 'Dust', injuries: 'Shoulder - old' } },
  ];

  const memberHash = await hashPw('Member@123');
  const memberRows = [];
  for (let i = 0; i < memberData.length; i++) {
    const m = memberData[i]!;
    const branchForMember = allBranches[i % allBranches.length]!;
    
    const [member] = await db.insert(members).values({
      organizationId: org!.id,
      branchId: branchForMember.id,
      memberNumber: `GYM${String(i + 1).padStart(4, '0')}`,
      firstName: m.firstName,
      lastName: m.lastName,
      email: m.email,
      phone: m.phone,
      gender: m.gender,
      dob: m.dob,
      address: m.address,
      goal: m.goal,
      experienceLevel: m.experienceLevel,
      joinDate: m.joinDate,
      status: 'ACTIVE',
    }).returning();
    memberRows.push(member!);
    await db.insert(memberEmergencyContacts).values({ memberId: member!.id, ...m.emergency });
    await db.insert(memberHealthProfiles).values({ memberId: member!.id, ...m.health });

    // Create user login for the member
    await db.insert(users).values({
      organizationId: org!.id,
      branchId: branchForMember.id,
      email: m.email,
      passwordHash: memberHash,
      role: 'MEMBER',
      firstName: m.firstName,
      lastName: m.lastName,
      phone: m.phone,
      status: 'ACTIVE',
      memberId: member!.id,
    });
  }

  // ── 9. Trainer Assignments ────────────────────────────────────────────────
  await db.insert(trainerAssignments).values({ organizationId: org!.id, branchId: branch1!.id, trainerId: trainer1!.id, memberId: memberRows[0]!.id, assignedBy: admin!.id });
  await db.insert(trainerAssignments).values({ organizationId: org!.id, branchId: branch1!.id, trainerId: trainer1!.id, memberId: memberRows[2]!.id, assignedBy: admin!.id });
  await db.insert(trainerAssignments).values({ organizationId: org!.id, branchId: branch1!.id, trainerId: trainer1!.id, memberId: memberRows[4]!.id, assignedBy: admin!.id });
  await db.insert(trainerAssignments).values({ organizationId: org!.id, branchId: branch1!.id, trainerId: trainer2!.id, memberId: memberRows[1]!.id, assignedBy: admin!.id });

  // ── 10. Memberships ────────────────────────────────────────────────────────
  log.info('Seeding memberships...');
  const [mem1] = await db.insert(memberMemberships).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[0]!.id, planId: plan2!.id, planName: 'Monthly Pro', startAt: new Date('2026-07-01T00:00:00+05:30'), expiresAt: new Date('2026-08-01T00:00:00+05:30'), timezone: 'Asia/Kolkata', status: 'ACTIVE', ptSessionsTotal: 2, createdBy: admin!.id }).returning();
  await db.insert(membershipEvents).values({ organizationId: org!.id, branchId: branch1!.id, membershipId: mem1!.id, memberId: memberRows[0]!.id, eventType: 'CREATED', actorId: admin!.id, actorName: 'Admin' });
  await db.insert(membershipEvents).values({ organizationId: org!.id, branchId: branch1!.id, membershipId: mem1!.id, memberId: memberRows[0]!.id, eventType: 'ACTIVATED', actorId: admin!.id, actorName: 'Admin' });

  const [mem2] = await db.insert(memberMemberships).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[1]!.id, planId: plan3!.id, planName: 'Quarterly Gold', startAt: new Date('2026-05-01T00:00:00+05:30'), expiresAt: new Date('2026-07-30T00:00:00+05:30'), timezone: 'Asia/Kolkata', status: 'ACTIVE', ptSessionsTotal: 6, createdBy: admin!.id }).returning();
  await db.insert(membershipEvents).values({ organizationId: org!.id, branchId: branch1!.id, membershipId: mem2!.id, memberId: memberRows[1]!.id, eventType: 'CREATED', actorId: admin!.id, actorName: 'Admin' });

  const [mem3] = await db.insert(memberMemberships).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[2]!.id, planId: plan5!.id, planName: 'Yearly Platinum', startAt: new Date('2025-11-10T00:00:00+05:30'), expiresAt: new Date('2026-11-11T00:00:00+05:30'), timezone: 'Asia/Kolkata', status: 'ACTIVE', ptSessionsTotal: 36, createdBy: admin!.id }).returning();
  await db.insert(membershipEvents).values({ organizationId: org!.id, branchId: branch1!.id, membershipId: mem3!.id, memberId: memberRows[2]!.id, eventType: 'CREATED', actorId: admin!.id, actorName: 'Admin' });

  const [mem4] = await db.insert(memberMemberships).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[3]!.id, planId: plan1!.id, planName: 'Monthly Basic', startAt: new Date('2026-06-01T00:00:00+05:30'), expiresAt: new Date('2026-07-01T00:00:00+05:30'), timezone: 'Asia/Kolkata', status: 'EXPIRED', ptSessionsTotal: 0, createdBy: admin!.id }).returning();
  await db.insert(membershipEvents).values({ organizationId: org!.id, branchId: branch1!.id, membershipId: mem4!.id, memberId: memberRows[3]!.id, eventType: 'CREATED', actorId: admin!.id, actorName: 'Admin' });

  const [mem5] = await db.insert(memberMemberships).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[4]!.id, planId: plan4!.id, planName: 'Half-Yearly Elite', startAt: new Date('2026-01-15T00:00:00+05:30'), expiresAt: new Date('2026-07-15T00:00:00+05:30'), timezone: 'Asia/Kolkata', status: 'ACTIVE', ptSessionsTotal: 15, createdBy: admin!.id }).returning();

  // ── 11. Attendance ─────────────────────────────────────────────────────────
  log.info('Seeding attendance...');
  await db.insert(attendanceLogs).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[0]!.id, memberName: 'Rahul Sharma', checkInAt: subHours(today, 2), checkOutAt: subHours(today, 0.5), checkInMethod: 'MANUAL', checkInBy: admin!.id });
  await db.insert(attendanceLogs).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[2]!.id, memberName: 'Arjun Verma', checkInAt: subHours(today, 3), checkOutAt: subHours(today, 0.5), checkInMethod: 'MANUAL', checkInBy: admin!.id });
  await db.insert(attendanceLogs).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[4]!.id, memberName: 'Vikram Nair', checkInAt: subHours(today, 1), checkOutAt: null, checkInMethod: 'MANUAL', checkInBy: admin!.id });
  await db.insert(attendanceLogs).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[1]!.id, memberName: 'Priya Mehta', checkInAt: subDays(subHours(today, 2), 1), checkOutAt: subDays(subHours(today, 0.5), 1), checkInMethod: 'MANUAL' });

  // ── 12. Payments ───────────────────────────────────────────────────────────
  log.info('Seeding payments...');
  await db.insert(paymentTransactions).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[0]!.id, memberName: 'Rahul Sharma', amount: '2500', gstAmount: '450', totalAmount: '2950', paymentMethod: 'UPI', status: 'PAID', referenceId: 'UPI20260701A', description: 'Monthly Pro membership', recordedBy: admin!.id, paidAt: new Date('2026-07-01') });
  await db.insert(paymentTransactions).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[2]!.id, memberName: 'Arjun Verma', amount: '18000', gstAmount: '3240', totalAmount: '21240', paymentMethod: 'CASH', status: 'PAID', description: 'Yearly Platinum membership', recordedBy: admin!.id, paidAt: new Date('2025-11-10') });
  await db.insert(paymentTransactions).values({ organizationId: org!.id, branchId: branch1!.id, memberId: memberRows[1]!.id, memberName: 'Priya Mehta', amount: '6500', gstAmount: '1170', totalAmount: '7670', paymentMethod: 'CARD', status: 'PENDING', referenceId: 'CARD20260709B', description: 'Quarterly Gold membership', recordedBy: admin!.id });

  // ── 13. PT Packages ────────────────────────────────────────────────────────
  log.info('Seeding PT packages and sessions...');
  const [ptPkg1] = await db.insert(ptPackages).values({ organizationId: org!.id, name: '12 Sessions', sessionsCount: 12, price: '6000', gstPercent: '18', status: 'ACTIVE' }).returning();
  const [ptPkg2] = await db.insert(ptPackages).values({ organizationId: org!.id, name: '24 Sessions', sessionsCount: 24, price: '10000', gstPercent: '18', status: 'ACTIVE' }).returning();
  await db.insert(ptPackages).values({ organizationId: org!.id, name: '48 Sessions', sessionsCount: 48, price: '18000', gstPercent: '18', status: 'ACTIVE' });

  await db.insert(ptSessions).values({ organizationId: org!.id, memberId: memberRows[0]!.id, trainerId: trainer1!.id, memberName: 'Rahul Sharma', trainerName: 'Amit Singh', scheduledAt: subDays(today, 1), status: 'COMPLETED', completedAt: subDays(today, 1), notes: 'Good session, focused on chest', createdBy: admin!.id });
  await db.insert(ptSessions).values({ organizationId: org!.id, memberId: memberRows[4]!.id, trainerId: trainer1!.id, memberName: 'Vikram Nair', trainerName: 'Amit Singh', scheduledAt: addDays(today, 0), status: 'UPCOMING', createdBy: admin!.id });
  await db.insert(ptSessions).values({ organizationId: org!.id, memberId: memberRows[1]!.id, trainerId: trainer2!.id, memberName: 'Priya Mehta', trainerName: 'Neha Gupta', scheduledAt: addDays(today, 0), status: 'UPCOMING', createdBy: admin!.id });

  // ── 14. Leads ──────────────────────────────────────────────────────────────
  log.info('Seeding leads...');
  const [lead1] = await db.insert(leads).values({ organizationId: org!.id, branchId: branch1!.id, name: 'Sanjay Kumar', phone: '9876500001', source: 'INSTAGRAM', status: 'TRIAL_BOOKED', notes: 'Interested in weight loss program', createdBy: admin!.id }).returning();
  await db.insert(leadActivities).values({ organizationId: org!.id, branchId: branch1!.id, leadId: lead1!.id, activityType: 'CALL', notes: 'Discussed pricing, seems interested.', actorId: admin!.id, actorName: 'Admin' });
  await db.insert(leads).values({ organizationId: org!.id, branchId: branch2!.id, name: 'Meena Pillai', phone: '9876500002', source: 'WALK_IN', status: 'CONTACTED', notes: 'Came in for pricing info', createdBy: admin!.id });
  await db.insert(leads).values({ organizationId: org!.id, branchId: branch3!.id, name: 'Rohan Das', phone: '9876500003', source: 'GOOGLE', status: 'JOINED', notes: 'Converted to Quarterly Gold', createdBy: admin!.id });
  await db.insert(leads).values({ organizationId: org!.id, branchId: branch1!.id, name: 'Aisha Khan', phone: '9876500004', source: 'REFERRAL', status: 'TRIAL_COMPLETED', notes: 'Referred by Arjun Verma', createdBy: admin!.id });
  await db.insert(leads).values({ organizationId: org!.id, branchId: branch2!.id, name: 'Dev Anand', phone: '9876500005', source: 'WHATSAPP', status: 'NEW_LEAD', notes: 'Messaged about membership plans', createdBy: admin!.id });

  // ── 15. Exercise Library ───────────────────────────────────────────────────
  log.info('Seeding exercises...');
  const exerciseData = [
    { name: 'Barbell Bench Press', muscleGroup: 'Chest', equipment: 'Barbell', difficulty: 'INTERMEDIATE' as const },
    { name: 'Pull-Up', muscleGroup: 'Back', equipment: 'Pull-up Bar', difficulty: 'INTERMEDIATE' as const },
    { name: 'Squat', muscleGroup: 'Legs', equipment: 'Barbell', difficulty: 'BEGINNER' as const },
    { name: 'Deadlift', muscleGroup: 'Back', equipment: 'Barbell', difficulty: 'ADVANCED' as const },
    { name: 'Shoulder Press', muscleGroup: 'Shoulders', equipment: 'Dumbbell', difficulty: 'INTERMEDIATE' as const },
    { name: 'Leg Press', muscleGroup: 'Legs', equipment: 'Machine', difficulty: 'BEGINNER' as const },
    { name: 'Dumbbell Curl', muscleGroup: 'Biceps', equipment: 'Dumbbell', difficulty: 'BEGINNER' as const },
    { name: 'Tricep Pushdown', muscleGroup: 'Triceps', equipment: 'Cable', difficulty: 'BEGINNER' as const },
    { name: 'Plank', muscleGroup: 'Core', equipment: 'Bodyweight', difficulty: 'BEGINNER' as const },
    { name: 'Romanian Deadlift', muscleGroup: 'Hamstrings', equipment: 'Barbell', difficulty: 'INTERMEDIATE' as const },
  ];

  const exerciseRows = [];
  for (const ex of exerciseData) {
    const [exercise] = await db.insert(exercises).values({ organizationId: org!.id, ...ex, isActive: true, createdBy: admin!.id }).returning();
    exerciseRows.push(exercise!);
  }

  // ── 16. Workout Templates ──────────────────────────────────────────────────
  log.info('Seeding workout templates...');
  const [wt1] = await db.insert(workoutTemplates).values({ organizationId: org!.id, name: 'Push Day', description: 'Chest, Shoulders, Triceps', trainerId: trainer1!.id, isActive: true, createdBy: admin!.id }).returning();
  await db.insert(workoutTemplateExercises).values({ templateId: wt1!.id, exerciseId: exerciseRows[0]!.id, sets: 4, reps: '8-10', restSeconds: 90, orderIndex: 0 });
  await db.insert(workoutTemplateExercises).values({ templateId: wt1!.id, exerciseId: exerciseRows[4]!.id, sets: 3, reps: '10-12', restSeconds: 60, orderIndex: 1 });

  const [wt2] = await db.insert(workoutTemplates).values({ organizationId: org!.id, name: 'Pull Day', description: 'Back, Biceps', trainerId: trainer1!.id, isActive: true, createdBy: admin!.id }).returning();
  await db.insert(workoutTemplateExercises).values({ templateId: wt2!.id, exerciseId: exerciseRows[1]!.id, sets: 4, reps: '6-8', restSeconds: 120, orderIndex: 0 });
  await db.insert(workoutTemplateExercises).values({ templateId: wt2!.id, exerciseId: exerciseRows[3]!.id, sets: 3, reps: '6', restSeconds: 180, orderIndex: 1 });

  await db.insert(workoutTemplates).values({ organizationId: org!.id, name: 'Leg Day', description: 'Quads, Hamstrings, Calves', trainerId: trainer3!.id, isActive: true, createdBy: admin!.id });
  await db.insert(workoutTemplates).values({ organizationId: org!.id, name: 'Beginner Fat Loss', description: 'Full body for beginners', trainerId: trainer2!.id, isActive: true, createdBy: admin!.id });

  log.info('✅ Seed completed successfully!');
  log.info('');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('🔑 Admin (Org Owner) credentials:');
  log.info('   Email:    admin@ironzone.com');
  log.info('   Password: Admin@123');
  log.info('');
  log.info('🏢 Branch Owner credentials:');
  log.info('   Email:    kora.owner@ironzone.com');
  log.info('   Password: Owner@123');
  log.info('');
  log.info('👤 Manager credentials:');
  log.info('   Email:    priya.k@ironzone.com');
  log.info('   Password: Manager@123');
  log.info('');
  log.info('💪 Trainer credentials:');
  log.info('   Email:    amit.trainer@ironzone.com');
  log.info('   Password: Trainer@123');
  log.info('');
  log.info('🏃 Member credentials (sample):');
  log.info('   Email:    rahul.sharma@email.com');
  log.info('   Password: Member@123');
  log.info('');
  log.info('🌐 API:  http://localhost:3001/api/v1');
  log.info('📚 Docs: http://localhost:3001/docs');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
