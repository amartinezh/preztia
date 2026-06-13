import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CreditController } from './credit/credit.controller';
import { ConversationsModule } from './conversations/conversations.module';
import { AuthModule } from './auth/auth.module';
import { tenantMiddleware } from './tenancy/tenant-context';

@Module({
  imports: [ConversationsModule, AuthModule],
  controllers: [CreditController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(tenantMiddleware).forRoutes('*');
  }
}
