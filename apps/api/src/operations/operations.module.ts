import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OperationsController } from './operations.controller';
import { OperationsRepository } from './operations.repository';

@Module({
  imports: [IdentityModule],
  controllers: [OperationsController],
  providers: [OperationsRepository],
})
export class OperationsModule {}
