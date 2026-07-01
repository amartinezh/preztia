import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NewsService } from './news.service';

/**
 * Reloj del "pulso del sector": refresca el snapshot una vez al día. Mantiene la landing "viva"
 * sola, sin intervención. La resiliencia y la mezcla de contenido las decide el servicio; este
 * cron solo marca el CUÁNDO. La hora se ajusta con NEWS_REFRESH_CRON (por defecto 06:00).
 */
@Injectable()
export class NewsCron {
  private readonly logger = new Logger('News:Cron');

  constructor(private readonly news: NewsService) {}

  @Cron(process.env.NEWS_REFRESH_CRON ?? '0 6 * * *')
  async refreshDaily(): Promise<void> {
    this.logger.log('Refrescando el pulso del sector (cron diario)');
    await this.news.refresh();
  }
}
