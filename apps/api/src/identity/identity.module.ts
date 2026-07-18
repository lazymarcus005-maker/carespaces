import { Module } from '@nestjs/common';
import { AuthenticationGuard } from './authentication.guard';
import { FakeIdentityService } from './fake-identity.service';
import { IDENTITY_PROVIDER } from './identity-provider';
import { IdentityController } from './identity.controller';
import { IdentityRepository } from './identity.repository';

@Module({
  controllers: [IdentityController],
  providers: [
    AuthenticationGuard,
    FakeIdentityService,
    IdentityRepository,
    { provide: IDENTITY_PROVIDER, useExisting: FakeIdentityService },
  ],
})
export class IdentityModule {}
