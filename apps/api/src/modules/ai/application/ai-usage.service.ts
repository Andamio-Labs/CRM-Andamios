import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Transaction } from '../../../shared/database/database.js';
import { aiAgents, subscriptions, tenantSettings } from '../../../shared/database/schema.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { planLimits } from '../../billing/domain/plans.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { quotaState } from '../domain/quota.js';

/** E05-S06 — Respuestas de IA enviadas en el mes calendario de la empresa (su zona horaria) contra el plan. */
@Injectable()
export class AiUsageService {
  constructor(private readonly tenant: TenantContext) {}

  get(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => {
      const usage = await this.usage(tx);
      const [agent] = await tx.select({ blockOnQuota: aiAgents.blockOnQuota }).from(aiAgents);
      return { ...usage, blockOnQuota: agent?.blockOnQuota ?? true };
    });
  }

  async usage(tx: Transaction) {
    const [settings] = await tx.select({ timezone: tenantSettings.timezone }).from(tenantSettings);
    const [sub] = await tx.select({ plan: subscriptions.plan }).from(subscriptions);
    const tz = settings?.timezone ?? 'America/Bogota';
    const { rows } = await tx.execute<{ used: number; month: string }>(sql`
      WITH m AS (SELECT date_trunc('month', now() AT TIME ZONE ${tz}) AS start)
      SELECT (SELECT count(*)::int FROM ai_interactions
               WHERE outcome = 'replied' AND channel = 'whatsapp' AND created_at >= (SELECT start FROM m) AT TIME ZONE ${tz}) AS used,
             to_char((SELECT start FROM m), 'YYYY-MM-DD') AS month`);
    const { used, month } = rows[0]!;
    return { month, ...quotaState(used, planLimits(sub?.plan ?? 'trial').aiRepliesPerMonth) };
  }
}
