import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ReconcilePendingPaymentsHandler } from '@preztiaos/application';
import {
  listPaymentAttemptsQuery,
  manualVerifyPaymentInput,
  paginationQuery,
  registerCashPaymentInput,
} from '@preztiaos/contracts';
import { PaymentsQueryRepository } from './payments-query.repository';
import { CashPaymentDrizzleRepository } from './cash-payment.repository';
import { ManualVerifyPaymentRepository } from './manual-verify-payment.repository';
import { PaymentReceiptOriginalStorage } from './payment-receipt-original.storage';
import { RunSettlementReconciliationService } from './run-settlement-reconciliation.service';
import { CollectorCreditScopeReader } from './collector-credit-scope.reader';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireReviewer } from '../auth/require-reviewer';
import { requireRole, type Session } from '../auth/require-role';

const uuid = z.string().uuid();

// Consultar y abonar la cartera lo hace cualquier rol del plano de datos; al COLLECTOR se le
// acota además a los clientes que tiene asignados (ver `CollectorCreditScopeReader`).
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
// Disparar la conciliación mueve dinero (confirma pagos): listón de revisor, como el resto
// de decisiones de cartera.
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/**
 * Frontera HTTP del slice de pagos: valida con zod (contrato) y delega.
 * No contiene reglas de negocio ni SQL. Protegido por JWT.
 */
@Controller()
@UseGuards(JwtGuard)
export class PaymentsController {
  constructor(
    private readonly queries: PaymentsQueryRepository,
    private readonly reconcile: ReconcilePendingPaymentsHandler,
    private readonly cashPayments: CashPaymentDrizzleRepository,
    private readonly manualVerify: ManualVerifyPaymentRepository,
    private readonly receipts: PaymentReceiptOriginalStorage,
    private readonly settlementReconcile: RunSettlementReconciliationService,
    private readonly collectorScope: CollectorCreditScopeReader,
  ) {}

  @Get('credits/:creditId/payments')
  async listPayments(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const id = uuid.parse(creditId);
    await this.assertWithinScope(tenant, session, id);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listCreditPayments({
      tenantId: tenant,
      creditId: id,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('credits/:creditId/payments')
  async registerCashPayment(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const id = uuid.parse(creditId);
    await this.assertWithinScope(tenant, session, id);
    const { amountMinor } = registerCashPaymentInput.parse(body);
    const result = await this.cashPayments.register({
      tenantId: tenant,
      creditId: id,
      amountMinor,
      idempotencyKey: idempotencyKey ?? null,
    });
    if (!result) throw new NotFoundException('Crédito no encontrado');
    return result;
  }

  @Get('credits/:creditId/portfolio')
  async getPortfolio(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const id = uuid.parse(creditId);
    await this.assertWithinScope(tenant, session, id);
    const portfolio = await this.queries.getPortfolio({
      tenantId: tenant,
      creditId: id,
    });
    if (!portfolio) throw new NotFoundException('Crédito no encontrado');
    return portfolio;
  }

  @Post('payments/reconcile')
  @HttpCode(200)
  async reconcilePayments(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    return this.reconcile.execute({ tenantId: tenant });
  }

  // Conciliación de la Fase 2 vía settlement_report (Mercado Pago): match + confirmación.
  @Post('payments/reconcile-settlement')
  @HttpCode(200)
  async reconcileSettlement(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    return this.settlementReconcile.execute({ tenantId: tenant });
  }

  @Get('payments')
  async listAttempts(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireReviewer(authorization);
    const {
      page,
      pageSize,
      status,
      failedOnly,
      q,
      bankStatus,
      minAmountMinor,
      maxAmountMinor,
      fromDate,
      toDate,
    } = listPaymentAttemptsQuery.parse(query);
    const { items, total } = await this.queries.listPaymentAttempts({
      tenantId: tenant,
      page,
      pageSize,
      ...(status ? { status } : {}),
      ...(failedOnly ? { failedOnly } : {}),
      ...(q ? { q } : {}),
      ...(bankStatus ? { bankStatus } : {}),
      ...(minAmountMinor !== undefined ? { minAmountMinor } : {}),
      ...(maxAmountMinor !== undefined ? { maxAmountMinor } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Get('payments/:paymentId')
  async paymentDetail(
    @Param('paymentId') paymentId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireReviewer(authorization);
    const detail = await this.queries.getPaymentDetail({
      tenantId: tenant,
      paymentId: uuid.parse(paymentId),
    });
    if (!detail) throw new NotFoundException('Pago no encontrado');
    return detail;
  }

  @Post('payments/:paymentId/manual-verification')
  @HttpCode(200)
  async manualVerifyPayment(
    @Param('paymentId') paymentId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const dto = manualVerifyPaymentInput.parse(body);
    return this.manualVerify.verify({
      tenantId: tenant,
      paymentId: uuid.parse(paymentId),
      decidedBy: reviewer.userId,
      reason: dto.reason,
      ...(dto.amountMinor ? { amountMinorOverride: dto.amountMinor } : {}),
    });
  }

  @Get('payments/:paymentId/receipt')
  async receipt(
    @Param('paymentId') paymentId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireReviewer(authorization);
    const original = await this.receipts.fetch({
      tenantId: tenant,
      paymentId: uuid.parse(paymentId),
    });
    // PII/evidencia en reposo: se muestra inline pero NUNCA se cachea.
    res
      .status(200)
      .setHeader('Content-Type', original.mimeType)
      .setHeader('Content-Disposition', 'inline')
      .setHeader('Cache-Control', 'no-store')
      .send(original.bytes);
  }

  /**
   * Acota al COLLECTOR a los créditos de su cartera asignada (ADMIN/COORDINATOR gobiernan
   * todo el tenant). Responde 404 —no 403— para no confirmarle la existencia de un crédito
   * que no le corresponde; mismo criterio que `collectionLogFor` en el slice de cobranza.
   */
  private async assertWithinScope(
    tenantId: string,
    session: Session,
    creditId: string,
  ): Promise<void> {
    if (session.role !== 'COLLECTOR') return;
    const inPortfolio = await this.collectorScope.isInPortfolio({
      tenantId,
      collectorId: session.userId,
      creditId,
    });
    if (!inPortfolio) throw new NotFoundException('Crédito no encontrado');
  }
}
