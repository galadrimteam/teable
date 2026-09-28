import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../custom.exception';
import { UserService } from '../user/user.service';
import type { IGaladrimUserRo } from './galadrim.schema';

@Injectable()
export class GaladrimUserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService
  ) {}

  async ensureUser(ro: IGaladrimUserRo) {
    const [user] = await this.ensureUsers([ro]);
    return user;
  }

  /** Finds each person by e-mail, else creates a bare user: no account, no space, never an admin. */
  async ensureUsers(ros: IGaladrimUserRo[]) {
    const emails = [...new Set(ros.map(({ email }) => email.toLowerCase()))];
    const existing = await this.prismaService.user.findMany({
      where: { email: { in: emails }, deletedTime: null },
    });
    const byEmail = new Map(existing.map((user) => [user.email, user]));
    const users = [];
    for (const { email, name } of ros) {
      const key = email.toLowerCase();
      const user = byEmail.get(key) ?? (await this.createUser(key, name));
      byEmail.set(key, user);
      users.push(user);
    }
    return users;
  }

  private async createUser(email: string, name: string) {
    try {
      // Not findOrCreateUser: it wants an OIDC account, obeys disallowSignUp and gives every person a space.
      const user = await this.userService.createUser({ email, name }, undefined, undefined, false);
      if (!user.isAdmin) {
        return user;
      }
      // createUser makes the first user of an empty instance its admin: that must be a person signing in, not whoever Outline names first.
      return await this.prismaService.user.update({
        where: { id: user.id },
        data: { isAdmin: null },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      // Either a concurrent request created the same person first, or the e-mail is held by a deleted user.
      const user = await this.userService.getUserByEmail(email);
      if (user) {
        return user;
      }
      throw new CustomHttpException(
        `${email} belongs to a deleted Teable user`,
        HttpErrorCode.CONFLICT
      );
    }
  }
}
