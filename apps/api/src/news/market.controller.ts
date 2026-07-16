import { Controller, Get, Header } from '@nestjs/common';
import { MarketService } from './market.service';

/**
 * Frontera HTTP PÚBLICA de los indicadores de mercado que alimentan la cinta de la landing.
 * Como `NewsController`, deliberadamente NO lleva `JwtGuard` (sin guard = público): solo sirve
 * un snapshot en memoria de fuentes públicas; no toca la BD ni datos de tenants; sin PII.
 */
@Controller('public/market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  get() {
    return this.market.getSnapshot();
  }
}
