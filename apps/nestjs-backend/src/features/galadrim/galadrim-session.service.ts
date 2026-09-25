import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { AuthService } from '../auth/auth.service';
import { JwtAuthInternalType } from '../auth/strategies/types';
import { GALADRIM_TOKEN_TTL } from './galadrim.config';

interface IGaladrimTokenUser {
  id: string;
  name: string;
  email: string;
  isSystem: boolean | null;
  deactivatedTime: Date | null;
}

export interface IGaladrimTokenVo {
  userId: string;
  token: string;
  expiresAt: string;
}

/**
 * Signs the JWTs Outline's server calls Teable with, through AuthService so that the claims stay the ones
 * JwtStrategy expects: `{ type: "user", baseId, userId }` (owner of that one base, as that person) or, without a
 * base, `{ userId }` (that person with their own collaborator rights).
 */
@Injectable()
export class GaladrimSessionService {
  constructor(
    private readonly authService: AuthService,
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {}

  async issueToken(user: IGaladrimTokenUser, baseId?: string): Promise<IGaladrimTokenVo> {
    if (user.isSystem || user.deactivatedTime) {
      throw new CustomHttpException(
        `${user.email} cannot act in Teable`,
        HttpErrorCode.RESTRICTED_RESOURCE
      );
    }
    const { accessToken, expiresTime } = baseId
      ? await this.signBaseToken(user, baseId)
      : await this.authService.getTempToken(GALADRIM_TOKEN_TTL, user.id);
    return { userId: user.id, token: accessToken, expiresAt: expiresTime };
  }

  private async signBaseToken({ id, name, email }: IGaladrimTokenUser, baseId: string) {
    const base = await this.prismaService.base.findFirst({
      where: { id: baseId, deletedTime: null },
      select: { id: true },
    });
    if (!base) {
      throw new CustomHttpException(`Base ${baseId} not found`, HttpErrorCode.NOT_FOUND);
    }
    // getTempInternalToken signs for the user of the current request, and this route has none.
    return this.cls.runWith({ ...this.cls.get(), user: { id, name, email } }, () =>
      this.authService.getTempInternalToken(baseId, JwtAuthInternalType.User, GALADRIM_TOKEN_TTL)
    );
  }
}
