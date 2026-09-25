import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { GaladrimSecretGuard } from './galadrim-secret.guard';
import type { IGaladrimTokenVo } from './galadrim-session.service';
import { GaladrimSessionService } from './galadrim-session.service';
import { GaladrimSpaceService } from './galadrim-space.service';
import { GaladrimUserService } from './galadrim-user.service';
import {
  galadrimEnsureUsersRoSchema,
  galadrimSpaceRoSchema,
  galadrimTokenRoSchema,
  IGaladrimEnsureUsersRo,
  IGaladrimSpaceRo,
  IGaladrimTokenRo,
} from './galadrim.schema';

/** Server-to-server routes for Outline; the shared secret replaces Teable's own authentication. */
@Controller('api/galadrim')
@Public()
@UseGuards(GaladrimSecretGuard)
export class GaladrimController {
  constructor(
    private readonly galadrimUserService: GaladrimUserService,
    private readonly galadrimSessionService: GaladrimSessionService,
    private readonly galadrimSpaceService: GaladrimSpaceService
  ) {}

  @Post('token')
  @HttpCode(200)
  async token(
    @Body(new ZodValidationPipe(galadrimTokenRoSchema)) { baseId, ...person }: IGaladrimTokenRo
  ): Promise<IGaladrimTokenVo> {
    const user = await this.galadrimUserService.ensureUser(person);
    return this.galadrimSessionService.issueToken(user, baseId);
  }

  @Post('users/ensure')
  @HttpCode(200)
  async ensureUsers(
    @Body(new ZodValidationPipe(galadrimEnsureUsersRoSchema)) { users }: IGaladrimEnsureUsersRo
  ): Promise<{ users: { email: string; id: string }[] }> {
    const ensured = await this.galadrimUserService.ensureUsers(users);
    return { users: ensured.map(({ email, id }) => ({ email, id })) };
  }

  @Post('space')
  @HttpCode(200)
  async space(
    @Body(new ZodValidationPipe(galadrimSpaceRoSchema)) { name }: IGaladrimSpaceRo
  ): Promise<{ spaceId: string }> {
    return this.galadrimSpaceService.ensureServiceSpace(name);
  }
}
