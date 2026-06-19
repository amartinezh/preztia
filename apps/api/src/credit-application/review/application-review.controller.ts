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
import {
  ApproveApplicationReviewHandler,
  OfferPlansHandler,
  RejectApplicationReviewHandler,
} from '@preztiaos/application';
import {
  approveApplicationInput,
  listApplicationsQuery,
  offerPlansInput,
  paginationQuery,
  rejectApplicationInput,
  requiredDocumentType,
} from '@preztiaos/contracts';
import { JwtGuard } from '../../auth/jwt.guard';
import { requireTenant } from '../../auth/require-tenant';
import { requireReviewer } from '../../auth/require-reviewer';
import { PaymentPlanRepository } from '../../credit/plans/payment-plan.repository';
import { TenantConfigRepository } from '../../tenant-config/tenant-config.repository';
import { resolveTenantCurrency } from '../../tenant-config/tenant-currency';
import { ApplicationReviewQueryRepository } from './application-review-query.repository';
import { ApplicationDecisionRepository } from './application-decision.repository';
import { DocumentOriginalStorage } from './document-original.storage';
import { PlanOfferRepository } from './plan-offer.repository';
import { PlanOfferWhatsappNotifier } from './plan-offer.notifier';

const uuid = z.string().uuid();

/**
 * Frontera HTTP de la revisión antifraude de cartera: valida con zod (contrato), exige JWT
 * y rol de revisión (ADMIN/COORDINATOR) y delega. No contiene reglas de negocio ni SQL; los
 * `DomainError` de los casos de uso los traduce el filtro global a 404/409.
 */
@Controller()
@UseGuards(JwtGuard)
export class ApplicationReviewController {
  private readonly approveHandler: ApproveApplicationReviewHandler;
  private readonly rejectHandler: RejectApplicationReviewHandler;
  private readonly offerHandler: OfferPlansHandler;

  constructor(
    private readonly queries: ApplicationReviewQueryRepository,
    private readonly decisions: ApplicationDecisionRepository,
    private readonly originals: DocumentOriginalStorage,
    private readonly planOffers: PlanOfferRepository,
    private readonly plans: PaymentPlanRepository,
    private readonly tenantConfig: TenantConfigRepository,
    private readonly offerNotifier: PlanOfferWhatsappNotifier,
  ) {
    // Fase 10: el otorgamiento toma los términos del plan negociado y exige aceptación del cliente
    // (salvo override permitido por el tenant).
    this.approveHandler = new ApproveApplicationReviewHandler(
      this.decisions,
      this.plans,
      this.tenantConfig,
    );
    this.rejectHandler = new RejectApplicationReviewHandler(this.decisions);
    this.offerHandler = new OfferPlansHandler(
      this.planOffers,
      this.plans,
      this.tenantConfig,
      this.offerNotifier,
    );
  }

  @Get('applications')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const { page, pageSize, status } = listApplicationsQuery.parse(query);
    const { items, total } = await this.queries.listApplications({
      session: reviewer,
      page,
      pageSize,
      ...(status ? { status } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Get('applications-rejections')
  async rejections(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listRejections({
      session: reviewer,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Get('applications/:id')
  async detail(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const detail = await this.queries.getApplicationReview({
      session: reviewer,
      applicationId: uuid.parse(id),
    });
    if (!detail) throw new NotFoundException('Expediente no encontrado');
    return detail;
  }

  @Get('applications/:id/conversation')
  async conversation(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const result = await this.queries.getConversation({
      session: reviewer,
      applicationId: uuid.parse(id),
    });
    if (!result) throw new NotFoundException('Expediente no encontrado');
    return result;
  }

  @Get('applications/:id/documents/:documentType/original')
  async original(
    @Param('id') id: string,
    @Param('documentType') documentType: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireReviewer(authorization);
    const original = await this.originals.fetch({
      tenantId: tenant,
      applicationId: uuid.parse(id),
      documentType: requiredDocumentType.parse(documentType),
    });
    // PII en reposo: se muestra inline pero NUNCA se cachea.
    res
      .status(200)
      .setHeader('Content-Type', original.mimeType)
      .setHeader('Content-Disposition', 'inline')
      .setHeader('Cache-Control', 'no-store')
      .send(original.bytes);
  }

  @Post('applications/:id/plan-offer')
  @HttpCode(200)
  async offerPlans(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const dto = offerPlansInput.parse(body);
    const result = await this.offerHandler.execute({
      tenantId: tenant,
      applicationId: uuid.parse(id),
      decidedBy: reviewer.userId,
      principalMinor: dto.principalMinor,
      // La moneda la fija el servidor según la configuración del tenant, no el cliente.
      currency: await resolveTenantCurrency(tenant),
    });
    return {
      applicationId: uuid.parse(id),
      planOfferStatus: result.planOfferStatus,
    };
  }

  @Post('applications/:id/approval')
  @HttpCode(200)
  async approve(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const dto = approveApplicationInput.parse(body);
    // La moneda la fija el servidor por despliegue (Brasil → BRL), no el cliente.
    return this.approveHandler.execute({
      tenantId: tenant,
      applicationId: uuid.parse(id),
      decidedBy: reviewer.userId,
      reason: dto.reason,
      borrowerId: dto.borrowerId,
      zoneId: dto.zoneId,
      principalMinor: dto.principalMinor,
      interestPct: dto.interestPct,
      installmentsCount: dto.installmentsCount,
      currency: await resolveTenantCurrency(tenant),
      ...(dto.borrowerPhone ? { borrowerPhone: dto.borrowerPhone } : {}),
    });
  }

  @Post('applications/:id/rejection')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const dto = rejectApplicationInput.parse(body);
    return this.rejectHandler.execute({
      tenantId: tenant,
      applicationId: uuid.parse(id),
      decidedBy: reviewer.userId,
      reason: dto.reason,
    });
  }
}
