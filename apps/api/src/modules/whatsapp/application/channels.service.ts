import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { whatsappChannels } from '../../../shared/database/schema.js';
import { AppError } from '../../../shared/http/app-error.js';
import { WHATSAPP_API } from '../../../shared/tokens.js';
import { PlanService } from '../../billing/plan.service.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { TenantSecrets } from '../../tenancy/infrastructure/tenant-secrets.js';
import { MetaApiError, type WhatsAppApi } from '../infrastructure/whatsapp-api.js';

const metaId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Id de Meta inválido');
export const connectSchema = z.object({ code: z.string().min(1).max(2000), wabaId: metaId, phoneNumberId: metaId }).strict();

export const tokenSecret = (phoneNumberId: string) => `whatsapp.token:${phoneNumberId}`;

const view = ({ tenantId: _t, connectedBy: _c, ...channel }: typeof whatsappChannels.$inferSelect) => channel;

/**
 * E04-S01 — Conexión por Embedded Signup. El front obtiene `code`, `wabaId` y `phoneNumberId`
 * del popup de Meta; acá se canjea el código, se suscribe la app, se registra el número
 * y el token queda cifrado (TenantSecrets). El token NUNCA sale por la API.
 */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly secrets: TenantSecrets,
    private readonly plans: PlanService,
    @Inject(WHATSAPP_API) private readonly api: WhatsAppApi,
  ) {}

  list(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => (await tx.select().from(whatsappChannels)).map(view));
  }

  async connect(auth: AuthContext, input: z.infer<typeof connectSchema>) {
    const taken = await this.tenant.run(auth, (tx) => tx.execute(sql`SELECT whatsapp_phone_taken(${input.phoneNumberId}, ${auth.tenantId}) AS taken`));
    if ((taken.rows[0] as { taken: boolean }).taken) {
      throw new AppError(HttpStatus.CONFLICT, 'PHONE_ALREADY_CONNECTED', 'Este número ya está conectado a otra empresa en BeeCRM.');
    }
    // E10-S01 — Reconectar un número propio no consume cupo; uno nuevo sí.
    const [own] = await this.tenant.run(auth, (tx) => tx.select({ id: whatsappChannels.id }).from(whatsappChannels).where(eq(whatsappChannels.phoneNumberId, input.phoneNumberId)));
    if (!own) await this.plans.assertCanAddChannel(auth.tenantId);

    let token: string;
    let info;
    const pin = String(randomInt(100000, 1000000));
    try {
      token = await this.api.exchangeCode(input.code);
      await this.api.subscribeApp(input.wabaId, token);
      await this.api.registerPhone(input.phoneNumberId, pin, token);
      info = await this.api.getPhone(input.phoneNumberId, token);
    } catch (error) {
      if (error instanceof MetaApiError) {
        throw new AppError(HttpStatus.BAD_REQUEST, 'WHATSAPP_CONNECT_FAILED', `Meta rechazó la conexión: ${error.error.message ?? 'sin detalle'}. Intenta de nuevo el proceso de conexión.`);
      }
      throw error;
    }

    await this.secrets.put(auth.tenantId, tokenSecret(input.phoneNumberId), token);
    await this.secrets.put(auth.tenantId, `whatsapp.pin:${input.phoneNumberId}`, pin);
    return this.tenant.run(auth, async (tx) => {
      const values = { ...info, wabaId: input.wabaId, status: 'connected' as const, connectedBy: auth.userId, updatedAt: new Date() };
      const [row] = await tx.insert(whatsappChannels)
        .values({ ...values, tenantId: auth.tenantId, phoneNumberId: input.phoneNumberId })
        .onConflictDoUpdate({ target: whatsappChannels.phoneNumberId, set: values })
        .returning();
      return view(row!);
    });
  }

  /** Estado, verificación y calidad actualizados desde Meta. */
  async refresh(auth: AuthContext, id: string) {
    const channel = await this.find(auth, id);
    const token = await this.secrets.get(auth.tenantId, tokenSecret(channel.phoneNumberId));
    if (!token) throw new AppError(HttpStatus.CONFLICT, 'CHANNEL_NEEDS_RECONNECT', 'Reconecta el número para actualizar su estado.');
    const info = await this.api.getPhone(channel.phoneNumberId, token);
    return this.tenant.run(auth, async (tx) => {
      const [row] = await tx.update(whatsappChannels).set({ ...info, updatedAt: new Date() }).where(eq(whatsappChannels.id, id)).returning();
      return view(row!);
    });
  }

  async disconnect(auth: AuthContext, id: string) {
    await this.find(auth, id);
    await this.tenant.run(auth, (tx) => tx.update(whatsappChannels).set({ status: 'disconnected', updatedAt: new Date() }).where(eq(whatsappChannels.id, id)));
  }

  private async find(auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [row] = await this.tenant.run(auth, (tx) => tx.select().from(whatsappChannels).where(eq(whatsappChannels.id, id)));
    if (!row) throw new NotFoundException();
    return row;
  }
}
