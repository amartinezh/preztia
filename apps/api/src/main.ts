import './env'; // carga el .env de la raíz antes de evaluar módulos que leen process.env
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true conserva el cuerpo crudo para verificar la firma del webhook de WhatsApp.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
