import { Injectable, Logger } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { NextFunction, Request, Response } from 'express';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import type { ISessionData } from '../../types/session';
import { SessionHandleService } from '../auth/session/session-handle.service';
import { getGaladrimOutlineUrl, getGaladrimTeableAdmins } from './galadrim.config';

/** The pages of Teable's own UI. Sign-in, shares, invitations, assets and error pages stay open. */
const gatedPages =
  /^\/(?:$|home$|space(?:\/|$)|base(?:\/|$)|setting(?:\/|$)|admin(?:\/|$)|developer(?:\/|$)|t\/)/;

const adminCacheMs = 60_000;

/**
 * Teable is only the engine behind Outline's databases: people who are not Teable admins are sent to Outline when they
 * open Teable's own pages. The API stays untouched, so Outline's server and the tools keep working.
 */
@Injectable()
export class GaladrimUiGateMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GaladrimUiGateMiddleware.name);
  private readonly admins = new Map<string, { isAdmin: boolean; at: number }>();

  constructor(
    private readonly sessionHandleService: SessionHandleService,
    private readonly prismaService: PrismaService
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const outlineUrl = getGaladrimOutlineUrl();
    if (!outlineUrl || req.method !== 'GET' || !gatedPages.test(req.path)) {
      return next();
    }
    try {
      const userId = await this.userIdOf(req);
      // No session: Teable sends the visitor to its sign-in, which Caddy hands to Forest.
      if (!userId || (await this.isAdmin(userId))) {
        return next();
      }
      return res.redirect(302, outlineUrl);
    } catch (error) {
      this.logger.warn(`UI gate skipped: ${(error as Error).message}`);
      return next();
    }
  }

  private async userIdOf(req: Request) {
    if (!req.headers.cookie?.includes(`${AUTH_SESSION_COOKIE_NAME}=`)) {
      return undefined;
    }
    // Loads the session into req.session; an anonymous session has no passport user.
    await this.sessionHandleService.getSessionIdFromRequest(req);
    return (req.session as Partial<ISessionData> | undefined)?.passport?.user?.id;
  }

  private async isAdmin(userId: string) {
    const cached = this.admins.get(userId);
    if (cached && Date.now() - cached.at < adminCacheMs) {
      return cached.isAdmin;
    }
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true, email: true },
    });
    const isAdmin =
      !!user && (!!user.isAdmin || getGaladrimTeableAdmins().includes(user.email.toLowerCase()));
    this.admins.set(userId, { isAdmin, at: Date.now() });
    return isAdmin;
  }
}
