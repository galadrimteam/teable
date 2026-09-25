import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { UserModule } from '../user/user.module';
import { GaladrimSecretGuard } from './galadrim-secret.guard';
import { GaladrimSessionService } from './galadrim-session.service';
import { GaladrimSpaceService } from './galadrim-space.service';
import { GaladrimUserFieldExtension } from './galadrim-user-field.extension';
import { GaladrimUserService } from './galadrim-user.service';
import { GaladrimWebhookListener } from './galadrim-webhook.listener';
import { GaladrimWebhookSender } from './galadrim-webhook.sender';
import { GaladrimController } from './galadrim.controller';

/** galadrim-proxy: lets Outline's server act in Teable as each person, and tells Outline what changed. */
@Module({
  imports: [AuthModule, UserModule, CollaboratorModule],
  controllers: [GaladrimController],
  providers: [
    GaladrimSecretGuard,
    GaladrimUserService,
    GaladrimSessionService,
    GaladrimSpaceService,
    GaladrimUserFieldExtension,
    GaladrimWebhookSender,
    GaladrimWebhookListener,
  ],
})
export class GaladrimModule {}
