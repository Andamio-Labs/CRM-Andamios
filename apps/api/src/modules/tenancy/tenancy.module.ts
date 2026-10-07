import { Module } from '@nestjs/common';
import type { Env } from '../../config/env.js';
import { parseKeyring, SecretBox } from '../../shared/crypto/secret-box.js';
import { ENV } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantContext } from './application/tenant-context.js';
import { TenantSecrets } from './infrastructure/tenant-secrets.js';
import { TenantSettingsController } from './tenant-settings.controller.js';

@Module({
  imports: [IdentityModule],
  controllers: [TenantSettingsController],
  providers: [
    {
      provide: SecretBox,
      inject: [ENV],
      useFactory: (env: Env) => new SecretBox(parseKeyring(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY)),
    },
    TenantSecrets,
    TenantContext,
  ],
  exports: [TenantSecrets, TenantContext],
})
export class TenancyModule {}
