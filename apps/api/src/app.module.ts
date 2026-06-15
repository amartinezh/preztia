import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CreditController } from './credit/credit.controller';
import { ConversationsModule } from './conversations/conversations.module';
import { AuthModule } from './auth/auth.module';
import { CreditApplicationReviewModule } from './credit-application/review/credit-application-review.module';
import { PlatformModule } from './platform/platform.module';
import { IamModule } from './iam/iam.module';
import { tenantMiddleware } from './tenancy/tenant-context';

@Module({
  imports: [
    ConversationsModule,
    AuthModule,
    CreditApplicationReviewModule,
    PlatformModule,
    IamModule,
  ],
  controllers: [CreditController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(tenantMiddleware).forRoutes('*');
  }
}
