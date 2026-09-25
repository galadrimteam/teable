import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { UserService } from '../user/user.service';
import { GaladrimUserService } from './galadrim-user.service';
import { outlineServiceUser } from './galadrim.config';

@Injectable()
export class GaladrimSpaceService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly galadrimUserService: GaladrimUserService
  ) {}

  /** The space `name` owned by Outline's service user, created on first call. */
  async ensureServiceSpace(name: string): Promise<{ spaceId: string }> {
    const owner = await this.galadrimUserService.ensureUser(outlineServiceUser);
    const existing = await this.prismaService.space.findFirst({
      where: { name, createdBy: owner.id, deletedTime: null },
      orderBy: { createdTime: 'asc' },
      select: { id: true },
    });
    if (existing) {
      return { spaceId: existing.id };
    }
    // Not SpaceService.createSpace: it obeys disallowSpaceCreation, which is meant for people, not for Outline.
    const space = await this.cls.runWith(
      { ...this.cls.get(), user: { id: owner.id, name: owner.name, email: owner.email } },
      () => this.prismaService.$tx(() => this.userService.createSpaceBySignup({ name }))
    );
    return { spaceId: space.id };
  }
}
