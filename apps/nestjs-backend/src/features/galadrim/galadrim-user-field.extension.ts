import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { APP_ROBOT_USER, AUTOMATION_ROBOT_USER } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { outlineServiceUser } from './galadrim.config';

type IUserLookup = CollaboratorService['getUserCollaboratorsByTableId'];

const robotUserIds = new Set([APP_ROBOT_USER.id, AUTOMATION_ROBOT_USER.id]);

/**
 * Teable only lets a user cell (and a conversion to a user field) name the collaborators of the table's base. Nobody
 * is a collaborator of Outline's bases, since Outline decides who sees them, so for Outline's calls the lookup also
 * matches any active person by id or e-mail. It wraps the one CollaboratorService instance instead of editing
 * collaborator.service.ts, so that upstream merges never touch this patch.
 */
@Injectable()
export class GaladrimUserFieldExtension implements OnModuleInit {
  constructor(
    private readonly collaboratorService: CollaboratorService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  onModuleInit() {
    const lookup: IUserLookup = this.collaboratorService.getUserCollaboratorsByTableId.bind(
      this.collaboratorService
    );
    this.collaboratorService.getUserCollaboratorsByTableId = async (tableId, query) => {
      const collaborators = await lookup(tableId, query);
      const values = query.containsIn.values;
      if (!values.length || !(await this.isGaladrimRequest(tableId))) {
        return collaborators;
      }
      const others = await this.prismaService.txClient().user.findMany({
        where: {
          OR: [{ id: { in: values } }, { email: { in: values.map((v) => v.toLowerCase()) } }],
          id: { notIn: collaborators.map(({ id }) => id) },
          deletedTime: null,
          isSystem: null,
        },
        select: { id: true, name: true, email: true, avatar: true, isSystem: true },
      });
      return [...collaborators, ...others];
    };
  }

  /** Outline's service user, or a user-type internal token (only Galadrim issues them) for the table's base. */
  private async isGaladrimRequest(tableId: string) {
    if (this.cls.get('user.email') === outlineServiceUser.email) {
      return true;
    }
    const tokenBaseId = this.cls.get('tempAuthBaseId');
    const userId = this.cls.get('user.id');
    if (!tokenBaseId || !userId || robotUserIds.has(userId)) {
      return false;
    }
    const table = await this.prismaService.txClient().tableMeta.findUnique({
      where: { id: tableId },
      select: { baseId: true },
    });
    return table?.baseId === tokenBaseId;
  }
}
