import type { INestApplication } from '@nestjs/common';
import { ErrorResponseFilter } from './common/error-response.filter';

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ErrorResponseFilter());
}
