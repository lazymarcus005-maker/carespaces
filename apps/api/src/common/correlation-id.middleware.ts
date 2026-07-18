import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[a-zA-Z0-9._:-]{1,128}$/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const candidate = request.header(REQUEST_ID_HEADER);
    const requestId =
      candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();

    request.headers[REQUEST_ID_HEADER] = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
