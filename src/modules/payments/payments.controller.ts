import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  listPaymentsService, recordPaymentService, getPaymentService, refundPaymentService,
  listInvoicesService, generateInvoiceService, getInvoiceService, getMemberPaymentsService,
  sendInvoiceWhatsAppService, getPublicInvoiceService,
} from './payments.service';
import { renderInvoiceHtml } from '../../templates/invoice.template';

export const paymentsController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await listPaymentsService(request.user.orgId, request.query as any));
  },
  async create(request: FastifyRequest, reply: FastifyReply) {
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const payment = await recordPaymentService(request.user.orgId, { ...(request.body as any), idempotencyKey }, request.user.userId, request.user.activeBranchId);
    return reply.status(201).send({ payment });
  },
  async getOne(request: FastifyRequest<{ Params: { paymentId: string } }>, reply: FastifyReply) {
    return reply.send({ payment: await getPaymentService(request.user.orgId, request.params.paymentId) });
  },
  async refund(request: FastifyRequest<{ Params: { paymentId: string } }>, reply: FastifyReply) {
    const refund = await refundPaymentService(request.user.orgId, request.params.paymentId, request.body as any, request.user.userId);
    return reply.status(201).send({ refund });
  },
  async listInvoices(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await listInvoicesService(request.user.orgId, request.query as any));
  },
  async generateInvoice(request: FastifyRequest, reply: FastifyReply) {
    const invoice = await generateInvoiceService(request.user.orgId, request.body as any, request.user.userId);
    return reply.status(201).send({ invoice });
  },
  async getInvoice(request: FastifyRequest<{ Params: { invoiceId: string } }>, reply: FastifyReply) {
    return reply.send({ invoice: await getInvoiceService(request.user.orgId, request.params.invoiceId) });
  },
  async getPublicInvoice(request: FastifyRequest<{ Params: { publicToken: string } }>, reply: FastifyReply) {
    const invoice = await getPublicInvoiceService(request.params.publicToken);
    reply.header('Cache-Control', 'private, no-store');
    reply.type('text/html; charset=utf-8');
    return reply.send(renderInvoiceHtml(invoice));
  },
  async getPublicInvoiceData(request: FastifyRequest<{ Params: { publicToken: string } }>, reply: FastifyReply) {
    const invoice = await getPublicInvoiceService(request.params.publicToken);
    return reply.send({ invoice });
  },
  async getInvoicePdf(request: FastifyRequest<{ Params: { invoiceId: string } }>, reply: FastifyReply) {
    const invoice = await getInvoiceService(request.user.orgId, request.params.invoiceId);
    const html = `<!DOCTYPE html><html><body><h1>Invoice ${invoice.invoiceNumber}</h1><p>Total: ₹${invoice.totalAmount}</p>${invoice.lineItems.map(li => `<p>${li.description}: ₹${li.totalAmount}</p>`).join('')}</body></html>`;
    reply.header('Content-Type', 'text/html');
    return reply.send(html);
  },
  async sendInvoiceWhatsApp(request: FastifyRequest<{ Params: { invoiceId: string } }>, reply: FastifyReply) {
    const delivery = await sendInvoiceWhatsAppService(request.user.orgId, request.params.invoiceId, request.user.userId);
    return reply.status(202).send({ delivery });
  },
  async memberPayments(request: FastifyRequest<{ Params: { memberId: string } }>, reply: FastifyReply) {
    return reply.send(await getMemberPaymentsService(request.user.orgId, request.params.memberId, request.query as any));
  },
  async webhook(_request: FastifyRequest, reply: FastifyReply) {
    return reply.send({ received: true });
  },
};
