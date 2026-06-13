import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { JwtGuard } from './jwt.guard';

/**
 * Slice de autenticación (IAM): login/refresh y el guard de verificación JWT.
 * Exporta `JwtGuard` para que los módulos que protegen endpoints (credit, payments)
 * lo apliquen con `@UseGuards`.
 */
@Module({
  controllers: [AuthController],
  providers: [JwtGuard],
  exports: [JwtGuard],
})
export class AuthModule {}
