import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { RECEIPT_MAX_BYTES } from '@preztiaos/domain';
import {
  commentInput,
  DEPOSIT_RECEIPT_FIELD,
  issueDepositOrderInput,
  listDepositOrdersQuery,
  reasonInput,
  reportDepositFields,
  verifyDepositInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireReviewer } from '../auth/require-reviewer';
import { requireRole, type Session } from '../auth/require-role';
import { zoneScopePredicate } from '../iam/zone-scope';
import { Idempotent } from '../observability/idempotent.decorator';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';
import { fileOrEmpty, type UploadedFileLike } from '../shared/uploaded-file';
import {
  DepositOrderDrizzleRepository,
  ownOrder,
} from './deposit-order.repository';
import { DepositOrderQueryRepository } from './deposit-order-query.repository';

const uuid = z.string().uuid();
const COLLECTOR_ROLES = ['COLLECTOR'] as const;
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;

/** Alcance sobre las órdenes: el cobrador solo las suyas; el coordinador su subárbol; el ADMIN todo. */
function orderAccess(session: Session): SQL | undefined {
  return session.role === 'COLLECTOR'
    ? ownOrder(session.userId)
    : zoneScopePredicate(session);
}

/**
 * Frontera HTTP de las ÓRDENES DE CONSIGNACIÓN. El coordinador emite, verifica, objeta y cancela
 * dentro de su subárbol; el cobrador ve, reporta (con comprobante) y comenta las suyas. Valida con
 * zod y delega; los `DomainError` los traduce el filtro global.
 */
@Controller()
@UseGuards(JwtGuard)
export class DepositOrderController {
  constructor(
    private readonly orders: DepositOrderDrizzleRepository,
    private readonly queries: DepositOrderQueryRepository,
  ) {}

  @Post('deposit-orders')
  @HttpCode(201)
  @Idempotent()
  async issue(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const currency = await resolveTenantCurrency(tenant);
    const orderId = await this.orders.issue({
      tenantId: tenant,
      issuedBy: reviewer.userId,
      zoneScope: zoneScopePredicate(reviewer),
      currency,
      body: issueDepositOrderInput.parse(body),
    });
    return this.view(tenant, orderId, zoneScopePredicate(reviewer));
  }

  @Get('deposit-orders')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const q = listDepositOrdersQuery.parse(query);
    const { items, total } = await this.queries.list({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
      access: zoneScopePredicate(reviewer),
      ...q,
    });
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  @Get('me/deposit-orders')
  async mine(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    const q = listDepositOrdersQuery.omit({ collectorId: true }).parse(query);
    const { items, total } = await this.queries.list({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
      access: ownOrder(session.userId),
      ...q,
    });
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  @Post('me/deposit-orders/:id/seen')
  @HttpCode(200)
  async seen(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    const orderId = uuid.parse(id);
    await this.orders.markSeen({
      tenantId: tenant,
      collectorId: session.userId,
      orderId,
    });
    return this.view(tenant, orderId, ownOrder(session.userId));
  }

  // Reporte con comprobante obligatorio (multipart). Multer corta en el tamaño máximo.
  @Post('me/deposit-orders/:id/report')
  @HttpCode(200)
  @Idempotent()
  @UseInterceptors(
    FileInterceptor(DEPOSIT_RECEIPT_FIELD, {
      limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 },
    }),
  )
  async report(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
    @UploadedFile() receipt: UploadedFileLike | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    const orderId = uuid.parse(id);
    await this.orders.report({
      tenantId: tenant,
      collectorId: session.userId,
      orderId,
      fields: reportDepositFields.parse(body),
      receipt: fileOrEmpty(receipt),
      now: new Date(),
    });
    return this.view(tenant, orderId, ownOrder(session.userId));
  }

  @Post('deposit-orders/:id/verify')
  @HttpCode(200)
  @Idempotent()
  async verify(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const orderId = uuid.parse(id);
    await this.orders.verify({
      tenantId: tenant,
      verifiedBy: reviewer.userId,
      orderId,
      zoneScope: zoneScopePredicate(reviewer),
      body: verifyDepositInput.parse(body),
    });
    return this.view(tenant, orderId, zoneScopePredicate(reviewer));
  }

  @Post('deposit-orders/:id/dispute')
  @HttpCode(200)
  async dispute(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    return this.closeAs('DISPUTED', id, tenantId, auth, body);
  }

  @Post('deposit-orders/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    return this.closeAs('CANCELLED', id, tenantId, auth, body);
  }

  @Post('deposit-orders/:id/comments')
  @HttpCode(201)
  async comment(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, DATA_PLANE_ROLES);
    const orderId = uuid.parse(id);
    const access = orderAccess(session);
    const eventId = await this.orders.comment({
      tenantId: tenant,
      actorId: session.userId,
      orderId,
      access,
      message: commentInput.parse(body).message,
    });
    const events = await this.queries.events({
      tenantId: tenant,
      orderId,
      access,
    });
    return events.find((e) => e.id === eventId);
  }

  @Get('deposit-orders/:id/events')
  async events(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, DATA_PLANE_ROLES);
    const items = await this.queries.events({
      tenantId: tenant,
      orderId: uuid.parse(id),
      access: orderAccess(session),
    });
    return { items };
  }

  @Get('deposit-orders/:id/bank-matches')
  async bankMatches(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const items = await this.queries.bankMatches({
      tenantId: tenant,
      orderId: uuid.parse(id),
      access: zoneScopePredicate(reviewer),
    });
    return { items };
  }

  // Comprobante descifrado (evidencia): inline y NUNCA en caché.
  @Get('deposit-orders/:id/receipt')
  async receipt(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, DATA_PLANE_ROLES);
    const original = await this.queries.receipt({
      tenantId: tenant,
      orderId: uuid.parse(id),
      access: orderAccess(session),
    });
    res
      .status(200)
      .setHeader('Content-Type', original.mimeType)
      .setHeader('Content-Disposition', 'inline')
      .setHeader('Cache-Control', 'no-store')
      .send(original.bytes);
  }

  private async closeAs(
    action: 'DISPUTED' | 'CANCELLED',
    id: string,
    tenantId: string | undefined,
    auth: string | undefined,
    body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const orderId = uuid.parse(id);
    await this.orders.close({
      tenantId: tenant,
      actorId: reviewer.userId,
      orderId,
      zoneScope: zoneScopePredicate(reviewer),
      action,
      reason: reasonInput.parse(body).reason,
    });
    return this.view(tenant, orderId, zoneScopePredicate(reviewer));
  }

  private async view(
    tenantId: string,
    orderId: string,
    access: SQL | undefined,
  ) {
    return this.queries.get({
      tenantId,
      currency: await resolveTenantCurrency(tenantId),
      orderId,
      access,
    });
  }
}
