import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';

@Module({
  imports: [DatabaseModule, HealthModule, IdentityModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
