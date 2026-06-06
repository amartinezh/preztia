import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { CreditController } from "./credit/credit.controller";
import { tenantMiddleware } from "./tenancy/tenant-context";

@Module({ controllers: [CreditController] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(tenantMiddleware).forRoutes("*");
  }
}
