import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';

@Module({
  imports: [IdentityModule],
  controllers: [NotificationsController],
  providers: [NotificationsRepository],
})
export class NotificationsModule {}