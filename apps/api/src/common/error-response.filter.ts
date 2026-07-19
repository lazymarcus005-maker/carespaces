import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorResponse } from '@carespaces/api-contracts';
import {
  IdempotencyRequestConflictError,
  StaleVersionError,
} from '@carespaces/database';

const STATUS_CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

function exceptionMessage(exception: unknown, status: number): string {
  if (
    exception instanceof IdempotencyRequestConflictError ||
    exception instanceof StaleVersionError
  ) {
    return exception.message;
  }
  if (!(exception instanceof HttpException)) return 'Internal server error';
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (
    typeof response === 'object' &&
    response !== null &&
    'message' in response
  ) {
    const message = response.message;
    if (typeof message === 'string') return message;
    if (
      Array.isArray(message) &&
      message.every((item) => typeof item === 'string')
    )
      return message.join('; ');
  }
  return status >= 500 ? 'Internal server error' : exception.message;
}

function exceptionStatus(exception: unknown): number {
  if (
    exception instanceof IdempotencyRequestConflictError ||
    exception instanceof StaleVersionError
  ) {
    return HttpStatus.CONFLICT;
  }
  return exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

function exceptionCode(exception: unknown, status: number): string {
  if (exception instanceof IdempotencyRequestConflictError) {
    return 'IDEMPOTENCY_KEY_REUSED';
  }
  if (exception instanceof StaleVersionError) return 'STALE_VERSION';
  return STATUS_CODES[status] ?? `HTTP_${status}`;
}

@Catch()
export class ErrorResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = exceptionStatus(exception);
    const requestId = request.header('x-request-id') ?? 'unknown';
    const body: ErrorResponse = {
      error: {
        code: exceptionCode(exception, status),
        message: exceptionMessage(exception, status),
        requestId,
        status,
      },
    };

    response.status(status).json(body);
  }
}
