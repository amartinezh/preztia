import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CreditController } from './credit/credit.controller';
import { ConversationsModule } from './conversations/conversations.module';
import { AuthModule } from './auth/auth.module';
import { CreditApplicationReviewModule } from './credit-application/review/credit-application-review.module';
import { PlatformModule } from './platform/platform.module';
import { IamModule } from './iam/iam.module';
import { BorrowersModule } from './borrowers/borrowers.module';
import { CashModule } from './cash/cash.module';
import { OperationsModule } from './operations/operations.module';
import { TrackingModule } from './tracking/tracking.module';
import { TenantConfigModule } from './tenant-config/tenant-config.module';
import { ReportingModule } from './reporting/reporting.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ObservabilityModule } from './observability/observability.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { PaymentPlanModule } from './credit/plans/payment-plan.module';
import { CollectionsModule } from './collections/collections.module';
import { NewsModule } from './news/news.module';
import { tenantMiddleware } from './tenancy/tenant-context';

@Module({
  imports: [
    // Reloj de tareas programadas (cron de cobranza por WhatsApp).
    ScheduleModule.forRoot(),
    ConversationsModule,
    AuthModule,
    CreditApplicationReviewModule,
    PlatformModule,
    IamModule,
    BorrowersModule,
    CashModule,
    OperationsModule,
    TrackingModule,
    TenantConfigModule,
    ReportingModule,
    DashboardModule,
    ObservabilityModule,
    WhatsappModule,
    PaymentPlanModule,
    CollectionsModule,
    NewsModule,
  ],
  controllers: [CreditController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(tenantMiddleware).forRoutes('*');
  }
}
