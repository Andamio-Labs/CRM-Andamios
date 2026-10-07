import { randomBytes } from 'node:crypto';

export interface PhoneInfo {
  displayPhone: string | null;
  verifiedName: string | null;
  nameStatus: string | null;
  qualityRating: string | null;
  messagingLimit: string | null;
}

export type OutboundPayload =
  | { type: 'text'; text: string }
  | { type: 'image' | 'video' | 'audio' | 'document'; link: string; caption?: string; filename?: string }
  | { type: 'template'; name: string; language: string; components?: unknown[] };

export class MetaApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly error: { code?: number; message?: string },
  ) {
    super(`Meta API ${httpStatus}: ${error.message ?? 'sin detalle'} (código ${error.code ?? '?'})`);
  }
}

/** Puerto hacia la WhatsApp Cloud API de Meta (E04). */
export interface WhatsAppApi {
  exchangeCode(code: string): Promise<string>;
  subscribeApp(wabaId: string, token: string): Promise<void>;
  registerPhone(phoneNumberId: string, pin: string, token: string): Promise<void>;
  getPhone(phoneNumberId: string, token: string): Promise<PhoneInfo>;
  send(phoneNumberId: string, token: string, to: string, payload: OutboundPayload): Promise<{ waMessageId: string }>;
  createTemplate(wabaId: string, token: string, template: TemplateDefinition): Promise<{ id: string; status: string }>;
  getMedia(mediaId: string, token: string): Promise<{ url: string; mimeType: string; fileSize: number }>;
  downloadMedia(url: string, token: string, maxBytes: number): Promise<Buffer>;
}

export interface TemplateDefinition {
  name: string;
  language: string;
  category: string;
  body: string;
  examples: string[];
}

/** Adaptador real: Graph API. Versión configurable (META_GRAPH_VERSION): verificar la vigente al actualizar. */
export class GraphWhatsAppApi implements WhatsAppApi {
  constructor(private readonly config: { baseUrl: string; version: string; appId: string; appSecret: string }) {}

  async exchangeCode(code: string) {
    const params = new URLSearchParams({ client_id: this.config.appId, client_secret: this.config.appSecret, code });
    const body = await this.call<{ access_token: string }>('GET', `/oauth/access_token?${params}`);
    return body.access_token;
  }

  async subscribeApp(wabaId: string, token: string) {
    await this.call('POST', `/${encodeURIComponent(wabaId)}/subscribed_apps`, token);
  }

  async registerPhone(phoneNumberId: string, pin: string, token: string) {
    await this.call('POST', `/${encodeURIComponent(phoneNumberId)}/register`, token, { messaging_product: 'whatsapp', pin });
  }

  async getPhone(phoneNumberId: string, token: string): Promise<PhoneInfo> {
    const fields = 'display_phone_number,verified_name,name_status,quality_rating,messaging_limit_tier';
    const p = await this.call<Record<string, string | undefined>>('GET', `/${encodeURIComponent(phoneNumberId)}?fields=${fields}`, token);
    return {
      displayPhone: p.display_phone_number ?? null,
      verifiedName: p.verified_name ?? null,
      nameStatus: p.name_status ?? null,
      qualityRating: p.quality_rating ?? null,
      messagingLimit: p.messaging_limit_tier ?? null,
    };
  }

  async send(phoneNumberId: string, token: string, to: string, payload: OutboundPayload) {
    const body: Record<string, unknown> = { messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/^\+/, ''), type: payload.type };
    if (payload.type === 'text') body.text = { body: payload.text, preview_url: false };
    else if (payload.type === 'template') body.template = { name: payload.name, language: { code: payload.language }, components: payload.components };
    else body[payload.type] = { link: payload.link, caption: payload.caption, filename: payload.filename };
    const res = await this.call<{ messages?: { id: string }[] }>('POST', `/${encodeURIComponent(phoneNumberId)}/messages`, token, body);
    const id = res.messages?.[0]?.id;
    if (!id) throw new MetaApiError(502, { message: 'Respuesta sin id de mensaje' });
    return { waMessageId: id };
  }

  async createTemplate(wabaId: string, token: string, t: TemplateDefinition) {
    const body = { type: 'BODY', text: t.body, ...(t.examples.length ? { example: { body_text: [t.examples] } } : {}) };
    return this.call<{ id: string; status: string }>('POST', `/${encodeURIComponent(wabaId)}/message_templates`, token, {
      name: t.name, language: t.language, category: t.category, components: [body],
    });
  }

  async getMedia(mediaId: string, token: string) {
    const m = await this.call<{ url: string; mime_type: string; file_size: number }>('GET', `/${encodeURIComponent(mediaId)}`, token);
    return { url: m.url, mimeType: m.mime_type, fileSize: Number(m.file_size) };
  }

  /** El archivo vive en un CDN de Meta que exige el mismo token. Se corta si supera el límite. */
  async downloadMedia(url: string, token: string, maxBytes: number) {
    if (!/^https:\/\/[\w.-]+\.(fbsbx|facebook|fbcdn|whatsapp)\.(com|net)\//.test(url)) throw new MetaApiError(400, { message: 'URL de media fuera de Meta' });
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new MetaApiError(res.status, { message: 'No se pudo descargar el archivo' });
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) throw new MetaApiError(413, { message: 'Archivo más grande que el límite' });
    return body;
  }

  private async call<T = unknown>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}/${this.config.version}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } } & T;
    if (!res.ok || json.error) throw new MetaApiError(res.status, json.error ?? {});
    return json;
  }
}

/**
 * Adaptador local (WHATSAPP_API=local): permite usar la bandeja en desarrollo sin cuenta de Meta.
 * "Conectar" acepta cualquier código; los envíos devuelven ids falsos. Los tests lo controlan con failNext.
 */
export class LocalWhatsAppApi implements WhatsAppApi {
  readonly sent: { phoneNumberId: string; to: string; payload: OutboundPayload }[] = [];
  private failures: MetaApiError[] = [];

  private readonly media = new Map<string, { mimeType: string; body: Buffer; fileSize?: number }>();

  failNext(error: MetaApiError) {
    this.failures.push(error);
  }

  setMedia(id: string, media: { mimeType: string; body: Buffer; fileSize?: number }) {
    this.media.set(id, media);
  }

  async createTemplate(_wabaId: string, _token: string, t: TemplateDefinition) {
    return { id: `tpl-local-${t.name}-${randomBytes(4).toString('hex')}`, status: 'PENDING' };
  }

  async getMedia(mediaId: string) {
    const m = this.media.get(mediaId) ?? { mimeType: 'image/jpeg', body: Buffer.from('imagen-local') };
    return { url: `https://lookaside.fbsbx.com/local/${mediaId}`, mimeType: m.mimeType, fileSize: m.fileSize ?? m.body.length };
  }

  async downloadMedia(url: string) {
    const m = this.media.get(url.split('/').pop()!) ?? { body: Buffer.from('imagen-local') };
    return m.body;
  }

  async exchangeCode(code: string) {
    if (code === 'invalid') throw new MetaApiError(400, { code: 100, message: 'Invalid verification code format' });
    return `local-token-${code}`;
  }

  async subscribeApp() {}

  async registerPhone() {}

  async getPhone(phoneNumberId: string): Promise<PhoneInfo> {
    return { displayPhone: '+57 300 000 0000', verifiedName: `Número local ${phoneNumberId}`, nameStatus: 'APPROVED', qualityRating: 'GREEN', messagingLimit: 'TIER_1K' };
  }

  async send(phoneNumberId: string, _token: string, to: string, payload: OutboundPayload) {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push({ phoneNumberId, to, payload });
    return { waMessageId: `wamid.local.${randomBytes(8).toString('hex')}` };
  }
}
