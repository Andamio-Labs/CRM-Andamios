import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** Eventos de negocio que otros módulos (automatización, analítica) escuchan sin acoplarse. */
export type DomainEvent =
  | { type: 'lead.created'; tenantId: string; contactId: string; dealId: string | null; conversationId: string | null }
  | { type: 'deal.stage_changed'; tenantId: string; dealId: string; stageId: string; actorId: string | null }
  | { type: 'deal.won'; tenantId: string; dealId: string; actorId: string | null };

type Handler<T extends DomainEvent['type']> = (event: Extract<DomainEvent, { type: T }>) => Promise<void>;

/**
 * Bus en proceso. Se publica DESPUÉS del commit; un handler que falla se registra y no rompe
 * la operación que lo originó (vender no puede fallar porque falló una automatización).
 * Cuando haya varias réplicas o se necesite reintento, este contrato pasa a un outbox + cola.
 */
@Injectable()
export class DomainEvents {
  private readonly handlers = new Map<string, Handler<DomainEvent['type']>[]>();
  private readonly logger = new Logger('DomainEvents');

  on<T extends DomainEvent['type']>(type: T, handler: Handler<T>) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler as unknown as Handler<DomainEvent['type']>]);
  }

  async emit(event: DomainEvent) {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        await handler(event as never);
      } catch (error) {
        this.logger.error(`Falló un handler de ${event.type}: ${(error as Error).message}`);
      }
    }
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}
