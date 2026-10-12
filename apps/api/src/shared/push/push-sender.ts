import webpush from 'web-push';

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export interface PushPayload { title: string; body: string | null; link: string | null; tag: string }

/** Puerto de Web Push. `gone`: el navegador revocó la suscripción y hay que borrarla. */
export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<'sent' | 'gone'>;
}

/** Web Push con VAPID. Si el envío falla por otra causa, lanza: quien llama decide si lo ignora. */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: { subject: string; publicKey: string; privateKey: string }) {}

  async send(target: PushTarget, payload: PushPayload) {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { vapidDetails: this.vapid, TTL: 60 * 60 * 24, timeout: 5000 },
      );
      return 'sent' as const;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone' as const;
      throw error;
    }
  }
}

/** Tests: guarda lo enviado; los endpoints en `gone` responden como suscripción vencida. */
export class InMemoryPushSender implements PushSender {
  readonly sent: { endpoint: string; payload: PushPayload }[] = [];
  readonly gone = new Set<string>();

  async send(target: PushTarget, payload: PushPayload) {
    if (this.gone.has(target.endpoint)) return 'gone' as const;
    this.sent.push({ endpoint: target.endpoint, payload });
    return 'sent' as const;
  }
}
