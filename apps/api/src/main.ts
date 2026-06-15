import './env'; // carga el .env de la raíz antes de evaluar módulos que leen process.env
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './shared/domain-exception.filter';

async function bootstrap() {
  // rawBody: true conserva el cuerpo crudo para verificar la firma del webhook de WhatsApp.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Traduce los DomainError de los casos de uso a códigos HTTP (404/409/400).
  app.useGlobalFilters(new DomainExceptionFilter());

  // CORS para que la app web (otro origen) pueda llamar al API desde el navegador.
  // En dev se refleja el origin; en prod, restringir con CORS_ORIGIN (lista separada por comas).
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-tenant-id',
      'Idempotency-Key',
      'X-Correlation-Id',
    ],
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
