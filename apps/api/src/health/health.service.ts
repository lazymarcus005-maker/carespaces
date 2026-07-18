import { Injectable } from '@nestjs/common';
import {
  HealthResponseSchema,
  type HealthResponse,
} from '@carespaces/api-contracts';

@Injectable()
export class HealthService {
  getHealth(now = new Date()): HealthResponse {
    return HealthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: now.toISOString(),
    });
  }
}
