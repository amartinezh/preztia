import { Module } from '@nestjs/common';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { NewsCron } from './news.cron';

/**
 * Módulo "pulso del sector": agrega titulares de feeds públicos (RSS/Atom) e indicadores de
 * mercado de APIs públicas gratuitas, y los mezcla con el changelog propio de la plataforma
 * para alimentar la landing. Construido solo con lo que ya existe en el monorepo
 * (`@nestjs/schedule` + `fetch` nativo + parsers propios); sin dependencias nuevas.
 * El `ScheduleModule.forRoot()` ya está registrado en `AppModule`.
 */
@Module({
  controllers: [NewsController, MarketController],
  providers: [NewsService, MarketService, NewsCron],
})
export class NewsModule {}
