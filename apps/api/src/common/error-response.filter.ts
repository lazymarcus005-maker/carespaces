import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorResponse } from '@carespaces/api-contracts';

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

@Catch()
export class ErrorResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request.header('x-request-id') ?? 'unknown';
    const body: ErrorResponse = {
      error: {
        code: STATUS_CODES[status] ?? `HTTP_${status}`,
        message: exceptionMessage(exception, status),
        requestId,
        status,
      },
    };

    response.status(status).json(body);
  }
}
