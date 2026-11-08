import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  GrantCreditHandler,
  RegisterMigratedCreditHandler,
  quoteCredit,
} from '@preztiaos/application';
import {
  grantCreditInput,
  quoteCreditInput,
  registerMigratedCreditInput,
  listAccountsQuery,
  paginationQuery,
  type CreditQuoteOutput,
} from '@preztiaos/contracts';
import { CreditDrizzleRepository } from './credit.repository';
import { CreditQueryRepository } from './credit-query.repository';
import { AccountsQueryRepository } from './accounts-query.repository';
import { BorrowerPolicyRepository } from './borrower-policy.repository';
import { MigratedCreditRepository } from './migrated-credit.repository';
import { requireAdmin } from '../auth/require-admin';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { requireReviewer } from '../auth/require-reviewer';
import { Idempotent } from '../observability/idempotent.decorator';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';
import { tenantToday } from '../tenant-config/tenant-timezone';
import { TenantConfigRepository } from '../tenant-config/tenant-config.repository';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { PaymentPlanRepository } from './plans/payment-plan.repository';

const uuid = z.string().uuid();

// Consultar créditos/cuentas lo puede hacer cualquier rol del plano de datos.
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;

/**
 * Frontera HTTP del slice de crédito: valida con zod (contrato) y delega.
 * Protegido por JWT (el tenant del header debe coincidir con el de la sesión).
 */
@Controller()
@UseGuards(JwtGuard)
export class CreditController {
  // El otorgamiento respeta el cupo/bloqueo del cliente (puerto de política sobre `borrower`) y el
  // bloqueo antifraude del interés (solo el de un plan activo, salvo la excepción del ADMIN).
  private readonly handler = new GrantCreditHandler(
    new CreditDrizzleRepository(),
    new BorrowerPolicyRepository(),
    {
      settings: new TenantConfigRepository(),
      plans: new PaymentPlanRepository(),
    },
  );
  // Carga de créditos del sistema anterior: sin cajas, sin cupo ni bloqueo de interés (solo ADMIN).
  private readonly migrateHandler = new RegisterMigratedCreditHandler(
    new MigratedCreditRepository(),
  );
  private readonly queries = new CreditQueryRepository();
  private readonly accounts = new AccountsQueryRepository();

  @Get('credits')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listCredits({
      tenantId: tenant,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  /**
   * Cotiza el cronograma SIN persistir nada: la misma regla pura que otorga (`quoteCredit`), con la
   * moneda del tenant y, si no viene fecha, el "hoy" de la EMPRESA (ADR #46). No es idempotente
   * porque no muta estado.
   */
  @Post('credits/quote')
  async quote(
    @Body() body: unknown,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<CreditQuoteOutput> {
    const tenant = requireTenant(tenantId);
    // Mismo listón que otorgar: quien no puede desembolsar tampoco negocia términos.
    requireReviewer(authorization);
    const dto = quoteCreditInput.parse(body);
    const startDate =
      dto.startDate ??
      (await withTenantTxFor(tenant, (tx) => tenantToday(tx, tenant)));
    return quoteCredit({
      principalMinor: dto.principalMinor,
      interestPct: dto.interestPct,
      installmentsCount: dto.installmentsCount,
      ...(dto.frequency ? { frequency: dto.frequency } : {}),
      startDate,
      currency: await resolveTenantCurrency(tenant),
    });
  }

  @Post('credits')
  @Idempotent()
  async grant(
    @Body() body: unknown,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    // Otorgar crédito ES la operación de desembolso: mismo listón que aprobar un expediente
    // (ADMIN/COORDINATOR). El COLLECTOR opera la ruta de cobro, no origina deuda.
    const reviewer = requireReviewer(authorization);
    const dto = grantCreditInput.parse(body); // validación con zod en la frontera
    // La moneda la fija el servidor según la configuración del tenant, no el cliente.
    return this.handler.execute({
      ...dto,
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
      grantedBy: reviewer.userId,
      grantedByRole: reviewer.role,
      // El crédito empieza HOY según la empresa (misma fecha que muestra la cotización).
      startDate: await withTenantTxFor(tenant, (tx) => tenantToday(tx, tenant)),
    });
  }

  @Post('credits/migrated')
  @Idempotent()
  async registerMigrated(
    @Body() body: unknown,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    // Cargar deuda heredada con condiciones libres y abonos pasados es una decisión del ADMIN.
    const admin = requireAdmin(authorization);
    const dto = registerMigratedCreditInput.parse(body);
    return this.migrateHandler.execute({
      tenantId: tenant,
      borrowerId: dto.borrowerId,
      zoneId: dto.zoneId,
      principalMinor: dto.principalMinor,
      interestPct: dto.interestPct,
      installmentsCount: dto.installmentsCount,
      frequency: dto.frequency,
      currency: await resolveTenantCurrency(tenant),
      startDate: dto.startDate,
      legacyReference: dto.legacyReference ?? null,
      payments: dto.payments,
      migratedBy: admin.userId,
    });
  }

  @Get('accounts')
  async listAccounts(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const { page, pageSize, q, name, nationalId, phone, onlyOverdue, status } =
      listAccountsQuery.parse(query);
    const { items, total } = await this.accounts.listAccounts({
      tenantId: tenant,
      page,
      pageSize,
      ...(q ? { q } : {}),
      ...(name ? { name } : {}),
      ...(nationalId ? { nationalId } : {}),
      ...(phone ? { phone } : {}),
      ...(onlyOverdue ? { onlyOverdue } : {}),
      ...(status ? { status } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Get('accounts/:creditId')
  async accountDetail(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const detail = await this.accounts.getAccountDetail({
      tenantId: tenant,
      creditId: uuid.parse(creditId),
    });
    if (!detail) throw new NotFoundException('Cuenta no encontrada');
    return detail;
  }
}
