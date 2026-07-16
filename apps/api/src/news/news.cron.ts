import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NewsService } from './news.service';
import { MarketService } from './market.service';

/**
 * Reloj del "pulso del sector": mantiene la landing viva sola, sin intervención. La resiliencia
 * y la mezcla de contenido las deciden los servicios; este cron solo marca el CUÁNDO:
 *  - titulares cada 30 min (NEWS_REFRESH_CRON) — la portada respira durante el día;
 *  - indicadores cada 15 min (MARKET_REFRESH_CRON) — la cinta de mercado se siente en vivo
 *    sin acercarse a los límites de los proveedores gratuitos.
 */
@Injectable()
export class NewsCron {
  private readonly logger = new Logger('News:Cron');

  constructor(
    private readonly news: NewsService,
    private readonly market: MarketService,
  ) {}

  @Cron(process.env.NEWS_REFRESH_CRON ?? '*/30 * * * *')
  async refreshNews(): Promise<void> {
    this.logger.log('Refrescando titulares del pulso del sector');
    await this.news.refresh();
  }

  @Cron(process.env.MARKET_REFRESH_CRON ?? '*/15 * * * *')
  async refreshMarket(): Promise<void> {
    this.logger.log('Refrescando indicadores de mercado');
    await this.market.refresh();
  }
}
