import { Controller, Get, Header } from '@nestjs/common';
import { NewsService } from './news.service';

/**
 * Frontera HTTP PÚBLICA del "pulso del sector" que alimenta la landing. Deliberadamente NO lleva
 * `JwtGuard`: en este API los guards son por-controlador (sin guard = público). No toca el plano
 * de datos de tenants ni la BD — solo devuelve un snapshot en memoria; sin PII.
 */
@Controller('public/news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=1800')
  get() {
    return this.news.getSnapshot();
  }
}
