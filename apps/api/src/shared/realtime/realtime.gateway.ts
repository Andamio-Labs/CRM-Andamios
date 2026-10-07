import { Global, Inject, Logger, Module } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type pg from 'pg';
import type { Namespace, Socket } from 'socket.io';
import type { Env } from '../../config/env.js';
import { recordVisibility } from '../../modules/identity/domain/permissions.js';
import type { Role } from '../../modules/identity/domain/roles.js';
import { SessionResolver } from '../../modules/identity/infrastructure/http/session.guard.js';
import { IdentityModule } from '../../modules/identity/identity.module.js';
import type { Database } from '../database/database.js';
import { tenantSettings } from '../database/schema.js';
import { withTenant } from '../database/with-tenant.js';
import { DB, ENV, PG_POOL } from '../tokens.js';

const rooms = {
  all: (t: string) => `t:${t}:all`,
  user: (t: string, u: string) => `t:${t}:u:${u}`,
  // Salas de control: solo para cortar conexiones, nunca reciben eventos de datos.
  controlUser: (t: string, u: string) => `t:${t}:ctl:u:${u}`,
  controlSellers: (t: string) => `t:${t}:ctl:sellers`,
};

/**
 * E03-S02 — Tiempo real. Seguridad:
 * - Origin debe ser la app (evita cross-site WebSocket hijacking con la cookie de sesión).
 * - Sesión, membresía y visibilidad se verifican al conectar, igual que en HTTP.
 * - Si cambia algo que afecta el acceso (baja, cambio de rol, regla de visibilidad), se corta
 *   la conexión: el cliente reconecta y vuelve a pasar por estas verificaciones.
 * Escala a varias réplicas agregando @socket.io/redis-adapter (Valkey ya está en el stack).
 */
@WebSocketGateway({ namespace: '/realtime', path: '/api/socket.io', cors: false, serveClient: false })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server?: Namespace;
  private readonly logger = new Logger('Realtime');

  constructor(
    private readonly sessions: SessionResolver,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async handleConnection(client: Socket) {
    try {
      if (client.handshake.headers.origin !== this.env.APP_URL) throw new Error('origen no permitido');
      const session = await this.sessions.resolveHeaders(client.handshake.headers);
      const tenantId = session?.session.activeOrganizationId;
      if (!session || !tenantId) throw new Error('sin sesión');
      const userId = session.user.id;
      const { rows } = await this.conn.pool.query<{ role: Role }>(
        `SELECT role FROM member WHERE "userId" = $1 AND "organizationId" = $2`,
        [userId, tenantId],
      );
      const role = rows[0]?.role;
      if (!role) throw new Error('no es miembro');
      const [settings] = await withTenant(this.db, tenantId, (tx) => tx.select().from(tenantSettings));
      const restricted = recordVisibility(role, { sellersSeeOnlyAssigned: settings?.sellersSeeOnlyAssigned ?? false }) === 'assigned';

      const joined = [restricted ? rooms.user(tenantId, userId) : rooms.all(tenantId), rooms.controlUser(tenantId, userId)];
      if (role === 'member') joined.push(rooms.controlSellers(tenantId));
      await client.join(joined);
      client.emit('ready');
    } catch (error) {
      this.logger.warn(`Conexión rechazada: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  /** Socket.IO deduplica: quien esté en ambas salas recibe el evento una sola vez. */
  publish(tenantId: string, event: string, payload: object, ownerId: string | null) {
    const targets = [rooms.all(tenantId), ...(ownerId ? [rooms.user(tenantId, ownerId)] : [])];
    this.server?.to(targets).emit(event, payload);
  }

  /** Baja o cambio de rol: el usuario debe re-autorizarse. */
  disconnectUser(tenantId: string, userId: string) {
    this.server?.in(rooms.controlUser(tenantId, userId)).disconnectSockets(true);
  }

  /** Cambió la regla de visibilidad: los vendedores reconectan y caen en la sala correcta. */
  disconnectSellers(tenantId: string) {
    this.server?.in(rooms.controlSellers(tenantId)).disconnectSockets(true);
  }
}

@Global()
@Module({ imports: [IdentityModule], providers: [RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
