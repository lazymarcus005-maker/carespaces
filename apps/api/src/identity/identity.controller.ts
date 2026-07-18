import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  CreateFamilyTenantRequestSchema,
  type FamilyTenantResponse,
} from '@carespaces/api-contracts';
import { can } from '@carespaces/authz';
import { z } from 'zod';
import { AuthenticationGuard } from './authentication.guard';
import {
  IdempotencyConflictError,
  IdentityRepository,
  MembershipNotFoundError,
} from './identity.repository';
import type { AuthenticatedRequest } from './identity.types';

const IdempotencyKeySchema = z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/);
const TenantIdSchema = z.uuid();

@ApiTags('identity')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard)
@Controller()
export class IdentityController {
  constructor(
    @Inject(IdentityRepository) private readonly repository: IdentityRepository,
  ) {}

  @Post('tenants/family')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: { $ref: '#/components/schemas/CreateFamilyTenantRequest' },
  })
  @ApiCreatedResponse({
    description: 'Family tenant and owner membership',
    schema: { $ref: '#/components/schemas/FamilyTenantResponse' },
  })
  @ApiBadRequestResponse({
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  })
  @ApiUnauthorizedResponse({
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  })
  @ApiConflictResponse({
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  })
  async createFamilyTenant(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId: string,
  ): Promise<FamilyTenantResponse> {
    if (!request.principal.contactVerified) {
      throw new ForbiddenException(
        'A verified contact method is required for onboarding',
      );
    }
    const parsedBody = CreateFamilyTenantRequestSchema.safeParse(body);
    const parsedKey = IdempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsedBody.success || !parsedKey.success) {
      throw new BadRequestException(
        'Valid displayName and Idempotency-Key are required',
      );
    }
    try {
      return await this.repository.createFamilyTenant({
        principal: request.principal,
        displayName: parsedBody.data.displayName,
        idempotencyKey: parsedKey.data,
        correlationId: requestId,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError)
        throw new ConflictException(error.message);
      throw error;
    }
  }

  @Get('identity/me')
  @ApiHeader({ name: 'X-Tenant-Id', required: true })
  @ApiOkResponse({
    description: 'Authenticated user membership in the requested tenant',
    schema: { $ref: '#/components/schemas/FamilyTenantResponse' },
  })
  @ApiBadRequestResponse({
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  })
  @ApiUnauthorizedResponse({
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  })
  @ApiForbiddenResponse({
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  })
  async getMe(
    @Req() request: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantId: string | undefined,
  ): Promise<FamilyTenantResponse> {
    const parsedTenantId = TenantIdSchema.safeParse(tenantId);
    if (!parsedTenantId.success)
      throw new BadRequestException('A valid X-Tenant-Id is required');
    try {
      const membership = await this.repository.getMembership(
        request.principal,
        parsedTenantId.data,
      );
      if (
        !can(
          {
            actorUserId: membership.userId,
            actorTenantId: membership.tenant.id,
            resourceTenantId: parsedTenantId.data,
            role: membership.membership.role,
          },
          'tenant.read',
        )
      ) {
        throw new ForbiddenException();
      }
      return membership;
    } catch (error) {
      if (error instanceof MembershipNotFoundError)
        throw new ForbiddenException();
      throw error;
    }
  }
}
