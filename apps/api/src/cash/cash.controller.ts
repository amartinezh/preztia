import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@preztiaos/db';
import { EXPENSE_RECEIPT_MAX_BYTES } from '@preztiaos/domain';
import {
  RequestExpenseHandler,
  ReviewExpenseHandler,
} from '@preztiaos/application';
import {
  createExpenseFields,
  EXPENSE_RECEIPT_FIELD,
  listExpensesQuery,
  reviewExpenseInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole, type Session } from '../auth/require-role';
import { zoneScopePredicate } from '../iam/zone-scope';
import { MinioExpenseReceiptStorage } from './expense-receipt.storage';
import { fileOrEmpty, type UploadedFileLike } from '../shared/uploaded-file';
import { Idempotent } from '../observability/idempotent.decorator';
import { ExpenseDrizzleRepository } from './expense.repository';
import { CashQueryRepository } from './cash-query.repository';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

const uuid = z.string().uuid();

const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
// Revisar gastos es del socio/coordinador (maker-checker).
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/**
 * Alcance sobre los gastos: el cobrador solo ve los suyos; el coordinador, los de su subárbol de
 * zonas; el ADMIN, todo el tenant. Se aplica igual a la lista y al comprobante.
 */
function expenseAccess(session: Session): SQL | undefined {
  if (session.role === 'COLLECTOR') {
    return eq(schema.expense.requestedBy, session.userId);
  }
  return zoneScopePredicate(session);
}

/**
 * Frontera HTTP de CAJA: gastos (maker-checker) y reporte diario (P&L de cartera). El dinero real
 * (saldos, movimientos) vive en el libro de cajas (CashBoxController). Protegido por JWT; el rol
 * fino lo exige cada endpoint.
 */
@Controller()
@UseGuards(JwtGuard)
export class CashController {
  private readonly requestExpense: RequestExpenseHandler;
  private readonly reviewExpenseHandler: ReviewExpenseHandler;

  constructor(
    private readonly expenses: ExpenseDrizzleRepository,
    private readonly queries: CashQueryRepository,
    private readonly receipts: MinioExpenseReceiptStorage,
  ) {
    this.requestExpense = new RequestExpenseHandler(
      this.expenses,
      this.receipts,
    );
    this.reviewExpenseHandler = new ReviewExpenseHandler(this.expenses);
  }

  // --- Gastos ---------------------------------------------------------------

  @Get('expenses')
  async listExpenses(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const { page, pageSize, status } = listExpensesQuery.parse(query);
    const { items, total } = await this.queries.listExpenses({
      tenantId: tenant,
      page,
      pageSize,
      access: expenseAccess(session),
      ...(status ? { status } : {}),
    });
    return { items, page, pageSize, total };
  }

  // Solicitud con comprobante obligatorio (multipart). Multer corta en el tamaño máximo; el tipo,
  // el vacío y el tamaño los decide el dominio (assertValidExpenseReceipt).
  @Post('expenses')
  @HttpCode(201)
  @Idempotent()
  @UseInterceptors(
    FileInterceptor(EXPENSE_RECEIPT_FIELD, {
      limits: { fileSize: EXPENSE_RECEIPT_MAX_BYTES, files: 1 },
    }),
  )
  async createExpense(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @UploadedFile() receipt: UploadedFileLike | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const dto = createExpenseFields.parse(body);
    return this.requestExpense.execute({
      tenantId: tenant,
      requestedBy: session.userId,
      description: dto.description,
      amountMinor: dto.amountMinor,
      receipt: fileOrEmpty(receipt),
    });
  }

  // Comprobante descifrado (evidencia): se muestra inline pero NUNCA se cachea.
  @Get('expenses/:id/receipt')
  async expenseReceipt(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const original = await this.receipts.fetch({
      tenantId: tenant,
      expenseId: uuid.parse(id),
      access: expenseAccess(session),
    });
    res
      .status(200)
      .setHeader('Content-Type', original.mimeType)
      .setHeader('Content-Disposition', 'inline')
      .setHeader('Cache-Control', 'no-store')
      .send(original.bytes);
  }

  @Patch('expenses/:id')
  async reviewExpense(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, MANAGER_ROLES);
    const dto = reviewExpenseInput.parse(body);
    return this.reviewExpenseHandler.execute({
      tenantId: tenant,
      expenseId: uuid.parse(id),
      reviewerId: session.userId,
      // El coordinador revisa solo su subárbol; el ADMIN, todo el tenant.
      reviewerZonePaths: session.role === 'ADMIN' ? null : session.zonePaths,
      approve: dto.approve,
      ...(dto.paidFromCashBoxId
        ? { paidFromCashBoxId: dto.paidFromCashBoxId }
        : {}),
      ...(dto.rejectionReason ? { rejectionReason: dto.rejectionReason } : {}),
    });
  }

  // --- Reporte diario -------------------------------------------------------

  @Get('reports/daily')
  async dailyReport(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const date =
      z.string().date().optional().parse(query.date) ??
      new Date().toISOString().slice(0, 10);
    return this.queries.getDailyReport({
      tenantId: tenant,
      date,
      currency: await resolveTenantCurrency(tenant),
    });
  }
}
