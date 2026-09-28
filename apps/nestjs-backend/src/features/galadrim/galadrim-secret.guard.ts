import { createHash, timingSafeEqual } from 'crypto';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { GALADRIM_SECRET_HEADER, getGaladrimSecret } from './galadrim.config';

// Hashing both sides gives timingSafeEqual two buffers of the same length, whatever the header holds.
const digest = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class GaladrimSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = getGaladrimSecret();
    const provided = context.switchToHttp().getRequest<Request>().headers[GALADRIM_SECRET_HEADER];
    if (
      !secret ||
      typeof provided !== 'string' ||
      !timingSafeEqual(digest(provided), digest(secret))
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
