import { db } from '../../db/index';
import {
  paymentTransactions, invoices, invoiceLineItems, refunds, reportExports,
} from '../../db/schema/payments.schema';
import { members } from '../../db/schema/members.schema';
import { eq, and, isNull, desc, count, sum, sql, gte, lte, lt, or, ilike } from 'drizzle-orm';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { parseCursorPagination, decodeCursor, buildCursorPaginatedResponse } from '../../common/pagination/paginate';
import { auditLog } from '../../common/audit/auditLog';
import { AuditAction } from '../../db/schema/audit.schema';
import { createLogger } from '../../common/logger/index';
import { addDays } from 'date-fns';
import { randomBytes, randomUUID } from 'crypto';
import { organizations } from '../../db/schema/org.schema';
import { getInvoiceSettingsService, getTaxSettingsService } from '../org/org.service';
import { config } from '../../config/env';
import { sendTextMessage, sendMediaMessage } from '../notifications/notifications.service';
import { renderInvoiceHtml } from '../../templates/invoice.template';
import puppeteer from 'puppeteer';

const log = createLogger('payments-service');

// ── Invoice number generator ──────────────────────────────────────────────────

async function generateInvoiceNumber(orgId: string, prefix: string): Promise<string> {
  const totalRes = await db.select({ total: count() }).from(invoices).where(eq(invoices.organizationId, orgId));
  const total = totalRes[0]?.total ?? 0;
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String((total ?? 0) + 1).padStart(4, '0')}`;
}

function invoiceViewUrl(token: string) {
  return `${config.publicWebUrl}/invoice/${token}`;
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// ── PDF generation ────────────────────────────────────────────────────────────

export async function generateInvoicePdfBuffer(invoice: Awaited<ReturnType<typeof getPublicInvoiceService>>): Promise<Buffer> {
  const html = renderInvoiceHtml(invoice);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfUint8Array = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdfUint8Array);
  } finally {
    await browser.close();
  }
}

// ── List Payments ─────────────────────────────────────────────────────────────

export async function listPaymentsService(orgId: string, query: Record<string, unknown>) {
  const { cursor, pageSize } = parseCursorPagination(query);

  const conditions: any[] = [eq(paymentTransactions.organizationId, orgId)];

  if (query['branchId']) conditions.push(eq(paymentTransactions.branchId, query['branchId'] as string));
  if (query['memberId']) conditions.push(eq(paymentTransactions.memberId, query['memberId'] as string));
  if (query['status']) conditions.push(eq(paymentTransactions.status, query['status'] as any));
  const startDate = query['startDate'] ?? query['dateFrom'];
  const endDate = query['endDate'] ?? query['dateTo'];
  if (startDate) conditions.push(gte(paymentTransactions.createdAt, new Date(`${startDate}T00:00:00.000Z`)));
  if (endDate) conditions.push(lte(paymentTransactions.createdAt, new Date(`${endDate}T23:59:59.999Z`)));
  const search = query['q'] ?? query['search'];
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(
      ilike(paymentTransactions.memberName!, term),
      ilike(paymentTransactions.description!, term),
      sql`CAST(${paymentTransactions.id} AS TEXT) ILIKE ${term}`,
    ));
  }

  const decodedCursor = decodeCursor<[string, string]>(cursor);
  if (decodedCursor) {
    const [cursorDate, cursorId] = decodedCursor;
    conditions.push(
      or(
        lt(paymentTransactions.createdAt, new Date(cursorDate)),
        and(eq(paymentTransactions.createdAt, new Date(cursorDate)), lt(paymentTransactions.id, cursorId))
      )
    );
  }

  const whereClause = and(...conditions);

  const items = await db.select().from(paymentTransactions).where(whereClause)
    .orderBy(desc(paymentTransactions.createdAt), desc(paymentTransactions.id))
    .limit(pageSize + 1);

  return buildCursorPaginatedResponse(items, pageSize, (item) => [
    item.createdAt.toISOString(),
    item.id,
  ]);
}

// ── Record Payment ────────────────────────────────────────────────────────────

export async function recordPaymentService(
  orgId: string,
  data: {
    memberId?: string;
    amount: number;
    gstAmount?: number;
    paymentMethod: string;
    referenceId?: string;
    description?: string;
    notes?: string;
    idempotencyKey?: string;
  },
  actorId: string,
  branchId?: string | null,
) {
  // Idempotency check
  if (data.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(paymentTransactions)
      .where(and(
        eq(paymentTransactions.idempotencyKey, data.idempotencyKey),
        eq(paymentTransactions.organizationId, orgId),
      ))
      .limit(1);
    if (existing) return existing;
  }

  let memberName: string | undefined;
  if (data.memberId) {
    const [m] = await db
      .select({ firstName: members.firstName, lastName: members.lastName })
      .from(members)
      .where(and(
        eq(members.id, data.memberId),
        eq(members.organizationId, orgId),
        isNull(members.deletedAt),
      ))
      .limit(1);
    if (!m) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');
    memberName = `${m.firstName} ${m.lastName}`;
  }

  const gstAmount = data.gstAmount ?? 0;
  const totalAmount = data.amount + gstAmount;

  const [payment] = await db
    .insert(paymentTransactions)
    .values({
      organizationId: orgId,
      branchId: branchId ?? undefined,
      memberId: data.memberId,
      memberName,
      amount: String(data.amount),
      gstAmount: String(gstAmount),
      totalAmount: String(totalAmount),
      paymentMethod: data.paymentMethod as any,
      status: 'PAID',
      referenceId: data.referenceId,
      description: data.description,
      notes: data.notes,
      idempotencyKey: data.idempotencyKey,
      recordedBy: actorId,
      paidAt: new Date(),
    })
    .returning();

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.PAYMENT_RECORDED,
    entityType: 'payment',
    entityId: payment!.id,
    description: `Payment ₹${totalAmount} recorded (${data.paymentMethod})`,
    afterState: payment,
  });

  log.info({ paymentId: payment!.id, amount: totalAmount }, 'Payment recorded');
  return payment;
}

// ── Get Payment ────────────────────────────────────────────────────────────────

export async function getPaymentService(orgId: string, paymentId: string) {
  const [payment] = await db
    .select()
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.id, paymentId), eq(paymentTransactions.organizationId, orgId)))
    .limit(1);
  if (!payment) throw AppError.notFound(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found');
  return payment;
}

// ── Refund ────────────────────────────────────────────────────────────────────

export async function refundPaymentService(
  orgId: string,
  paymentId: string,
  data: { amount: number; reason: string },
  actorId: string,
) {
  const payment = await getPaymentService(orgId, paymentId);

  if (['REFUNDED', 'CANCELLED'].includes(payment.status)) {
    throw AppError.conflict(ErrorCode.PAYMENT_ALREADY_REFUNDED, 'Payment has already been refunded');
  }

  if (!Number.isFinite(data.amount) || data.amount <= 0) {
    throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Refund amount must be greater than zero');
  }

  const [refundTotal] = await db
    .select({ total: sum(refunds.amount) })
    .from(refunds)
    .where(and(eq(refunds.paymentId, paymentId), eq(refunds.status, 'PROCESSED')));
  const alreadyRefunded = Number(refundTotal?.total ?? 0);
  const refundableAmount = Math.max(0, Number(payment.totalAmount) - alreadyRefunded);
  if (data.amount > refundableAmount) {
    throw AppError.badRequest(ErrorCode.REFUND_EXCEEDS_PAYMENT, 'Refund amount exceeds payment total');
  }

  const [refund_] = await db
    .insert(refunds)
    .values({
      paymentId,
      amount: String(data.amount),
      reason: data.reason,
      status: 'PROCESSED',
      processedBy: actorId,
      processedAt: new Date(),
    })
    .returning();

  // Update payment status
  const newStatus = data.amount >= refundableAmount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  await db.update(paymentTransactions).set({ status: newStatus as any, updatedAt: new Date() }).where(eq(paymentTransactions.id, paymentId));

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.PAYMENT_REFUNDED,
    entityType: 'payment',
    entityId: paymentId,
    description: `Refund ₹${data.amount}: ${data.reason}`,
    afterState: refund_,
  });

  return refund_;
}

// ── Invoices ──────────────────────────────────────────────────────────────────

export async function listInvoicesService(orgId: string, query: Record<string, unknown>) {
  const { cursor, pageSize } = parseCursorPagination(query);

  const conditions: any[] = [eq(invoices.organizationId, orgId)];

  const decodedCursor = decodeCursor<[string, string]>(cursor);
  if (decodedCursor) {
    const [cursorDate, cursorId] = decodedCursor;
    conditions.push(
      or(
        lt(invoices.createdAt, new Date(cursorDate)),
        and(eq(invoices.createdAt, new Date(cursorDate)), lt(invoices.id, cursorId))
      )
    );
  }

  const items = await db.select().from(invoices)
    .where(and(...conditions))
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(pageSize + 1);

  const paginatedResponse = buildCursorPaginatedResponse(items, pageSize, (item) => [
    item.createdAt.toISOString(),
    item.id,
  ]);

  return {
    ...paginatedResponse,
    data: paginatedResponse.data.map(invoice => ({
      ...invoice,
      publicViewUrl: invoiceViewUrl(invoice.publicToken)
    }))
  };
}

export async function generateInvoiceService(
  orgId: string,
  data: {
    memberId?: string;
    membershipId?: string;
    lineItems: { description: string; quantity: number; unitPrice: number; gstPercent: number }[];
    notes?: string;
    footer?: string;
    dueDate?: string;
  },
  actorId: string,
) {
  if (!Array.isArray(data.lineItems) || data.lineItems.length === 0) {
    throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Add at least one invoice line item');
  }

  let memberName: string | undefined;
  if (data.memberId) {
    const [m] = await db.select({ firstName: members.firstName, lastName: members.lastName }).from(members)
      .where(and(eq(members.id, data.memberId), eq(members.organizationId, orgId), isNull(members.deletedAt))).limit(1);
    if (!m) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');
    memberName = `${m.firstName} ${m.lastName}`.trim();
  }

  const invoiceSettings = await getInvoiceSettingsService(orgId);
  const taxSettings = await getTaxSettingsService(orgId);

  let subtotal = 0;
  let gstTotal = 0;
  const lineItemData = data.lineItems.map((li) => {
    if (!Number.isInteger(li.quantity) || li.quantity < 1 || !Number.isFinite(li.unitPrice) || li.unitPrice < 0) {
      throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Each invoice line item must have a positive quantity and a valid price');
    }

    const displayedAmount = roundMoney(li.quantity * li.unitPrice);
    const taxableAmount = taxSettings.taxIncluded && taxSettings.taxRate > 0
      ? roundMoney(displayedAmount / (1 + taxSettings.taxRate / 100))
      : displayedAmount;
    const gstAmount = taxSettings.taxIncluded
      ? roundMoney(displayedAmount - taxableAmount)
      : roundMoney(taxableAmount * taxSettings.taxRate / 100);
    const totalAmount = taxSettings.taxIncluded ? displayedAmount : roundMoney(taxableAmount + gstAmount);

    subtotal = roundMoney(subtotal + taxableAmount);
    gstTotal = roundMoney(gstTotal + gstAmount);
    return {
      ...li,
      gstPercent: taxSettings.taxRate,
      totalAmount: String(totalAmount),
    };
  });

  const totalAmount = roundMoney(subtotal + gstTotal);

  const invoice = await db.transaction(async (tx) => {
    // The advisory lock makes configured invoice numbering safe across API instances.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice-number:${orgId}`}))`);
    const invoiceNumber = await generateInvoiceNumber(orgId, invoiceSettings.prefix);
    const [created] = await tx.insert(invoices).values({
      organizationId: orgId,
      memberId: data.memberId,
      membershipId: data.membershipId,
      memberName,
      invoiceNumber,
      publicToken: randomBytes(24).toString('base64url'),
      subtotal: String(subtotal),
      gstAmount: String(gstTotal),
      gstPercent: String(taxSettings.taxRate),
      taxIncluded: taxSettings.taxIncluded,
      totalAmount: String(totalAmount),
      status: 'DRAFT',
      notes: data.notes,
      footer: data.footer ?? invoiceSettings.footer,
      dueDate: data.dueDate ? new Date(data.dueDate) : invoiceSettings.dueDays > 0 ? addDays(new Date(), invoiceSettings.dueDays) : undefined,
      createdBy: actorId,
    }).returning();

    for (const li of lineItemData) {
      await tx.insert(invoiceLineItems).values({
        invoiceId: created!.id,
        description: li.description,
        quantity: li.quantity,
        unitPrice: String(li.unitPrice),
        gstPercent: String(li.gstPercent),
        totalAmount: li.totalAmount,
      });
    }
    return created!;
  });
  const invoiceNumber = invoice.invoiceNumber;

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.INVOICE_GENERATED,
    entityType: 'invoice',
    entityId: invoice!.id,
    description: `Invoice ${invoiceNumber} generated: ₹${totalAmount}`,
  });

  return { ...invoice, lineItems: lineItemData, publicViewUrl: invoiceViewUrl(invoice.publicToken) };
}

export async function generateMembershipInvoiceService(
  orgId: string,
  data: { memberId: string; membershipId: string; planName: string; price: string; gstPercent: string; notes?: string },
  actorId: string,
) {
  const [existing] = await db.select().from(invoices)
    .where(and(eq(invoices.organizationId, orgId), eq(invoices.membershipId, data.membershipId)))
    .limit(1);
  if (existing) return getInvoiceService(orgId, existing.id);

  return generateInvoiceService(orgId, {
    memberId: data.memberId,
    membershipId: data.membershipId,
    lineItems: [{ description: `Membership renewal - ${data.planName}`, quantity: 1, unitPrice: Number(data.price), gstPercent: Number(data.gstPercent) }],
    notes: data.notes,
  }, actorId);
}

export async function getInvoiceService(orgId: string, invoiceId: string) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, orgId)))
    .limit(1);
  if (!invoice) throw AppError.notFound(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found');

  const lineItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  return { ...invoice, lineItems, publicViewUrl: invoiceViewUrl(invoice.publicToken) };
}

export async function getPublicInvoiceService(publicToken: string) {
  const [row] = await db.select({ invoice: invoices, organization: organizations }).from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
    .where(eq(invoices.publicToken, publicToken))
    .limit(1);
  if (!row) throw AppError.notFound(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found');
  const lineItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, row.invoice.id));
  return { ...row.invoice, lineItems, organization: row.organization, publicViewUrl: invoiceViewUrl(row.invoice.publicToken) };
}

export async function sendInvoiceWhatsAppService(orgId: string, invoiceId: string, actorId: string) {
  const invoice = await getInvoiceService(orgId, invoiceId);
  if (!invoice.memberId) {
    throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'This invoice is not linked to a member with a WhatsApp contact');
  }

  const [member] = await db
    .select({ id: members.id, firstName: members.firstName, lastName: members.lastName, phone: members.phone })
    .from(members)
    .where(and(
      eq(members.id, invoice.memberId),
      eq(members.organizationId, orgId),
      isNull(members.deletedAt),
    ))
    .limit(1);

  if (!member?.phone) {
    throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Add a phone number to this member before sending the invoice');
  }

  const invoiceSettings = await getInvoiceSettingsService(orgId);
  const memberName = `${member.firstName} ${member.lastName}`.trim();
  const text = `Hello ${memberName}, your invoice ${invoice.invoiceNumber} totals Rs. ${invoice.totalAmount}. View it here: ${invoice.publicViewUrl}`;
  const idempotencyKey = `invoice-manual:${invoice.id}:${randomUUID()}`;

  let delivery;
  if (invoiceSettings.attachInvoicePdf) {
    const publicInvoice = await getPublicInvoiceService(invoice.publicToken);
    const pdfBuffer = await generateInvoicePdfBuffer(publicInvoice);
    delivery = await sendMediaMessage({
      ctx: { organizationId: orgId } as any,
      memberId: member.id,
      invoiceId: invoice.id,
      eventType: 'INVOICE',
      phone: member.phone,
      text,
      pdfBuffer,
      filename: `Invoice_${invoice.invoiceNumber}.pdf`,
      idempotencyKey,
      actorId,
    });
  } else {
    delivery = await sendTextMessage({
      ctx: { organizationId: orgId } as any,
      memberId: member.id,
      invoiceId: invoice.id,
      eventType: 'INVOICE',
      phone: member.phone,
      text,
      idempotencyKey,
      actorId,
    });
  }

  if (delivery.status === 'SENT') {
    await db.update(invoices).set({ status: 'SENT', updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
  }

  await auditLog({
    organizationId: orgId,
    actorId,
    action: AuditAction.INVOICE_WHATSAPP_QUEUED,
    entityType: 'invoice',
    entityId: invoice.id,
    description: `Invoice message requested for ${invoice.invoiceNumber}`,
    afterState: { status: delivery.status, provider: delivery.provider, recipient: delivery.recipient },
  });

  log.info({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    recipient: delivery.recipient,
    provider: delivery.provider,
  }, 'Invoice message delivery completed');

  return { ...delivery, invoiceNumber: invoice.invoiceNumber, publicViewUrl: invoice.publicViewUrl };
}

export async function getMemberPaymentsService(orgId: string, memberId: string, query: Record<string, unknown>) {
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt)))
    .limit(1);
  if (!member) throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');

  const { cursor, pageSize } = parseCursorPagination(query);

  const conditions: any[] = [eq(paymentTransactions.memberId, memberId)];

  const decodedCursor = decodeCursor<[string, string]>(cursor);
  if (decodedCursor) {
    const [cursorDate, cursorId] = decodedCursor;
    conditions.push(
      or(
        lt(paymentTransactions.createdAt, new Date(cursorDate)),
        and(eq(paymentTransactions.createdAt, new Date(cursorDate)), lt(paymentTransactions.id, cursorId))
      )
    );
  }

  const items = await db.select().from(paymentTransactions)
    .where(and(...conditions))
    .orderBy(desc(paymentTransactions.createdAt), desc(paymentTransactions.id))
    .limit(pageSize + 1);

  return buildCursorPaginatedResponse(items, pageSize, (item) => [
    item.createdAt.toISOString(),
    item.id,
  ]);
}
