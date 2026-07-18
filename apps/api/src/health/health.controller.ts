import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@carespaces/api-contracts';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthService) private readonly healthService: HealthService,
  ) {}

  @Get()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/HealthResponse' },
  })
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
