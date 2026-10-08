import { randomBytes } from 'node:crypto';

export interface WompiAcceptance {
  acceptanceToken: string;
  termsUrl: string;
  personalDataAuthToken: string;
  personalDataUrl: string;
}

export interface WompiTransactionRequest {
  amount_in_cents: number;
  currency: 'COP';
  customer_email: string;
  payment_method: { installments: number };
  payment_source_id: number;
  reference: string;
  signature: string;
  recurrent: boolean;
}

export class WompiApiError extends Error {}

/** Puerto hacia Wompi (E10-S03). Llave privada solo en el servidor; la tarjeta la tokeniza el navegador. */
export interface WompiApi {
  getAcceptance(): Promise<WompiAcceptance>;
  createPaymentSource(input: { token: string; customerEmail: string; acceptanceToken: string; acceptPersonalAuth: string }): Promise<{ id: string }>;
  createTransaction(request: WompiTransactionRequest): Promise<{ id: string; status: string; statusMessage: string | null }>;
}

export class HttpWompiApi implements WompiApi {
  constructor(private readonly config: { baseUrl: string; publicKey: string; privateKey: string }) {}

  async getAcceptance(): Promise<WompiAcceptance> {
    // GET /merchants/:llave reemplazado: deja de existir el 31-oct-2026.
    const data = await this.request<{ presigned_acceptance: { acceptance_token: string; permalink: string }; presigned_personal_data_auth: { acceptance_token: string; permalink: string } }>(
      '/merchants/info', { headers: { 'x-merchant-public-key': this.config.publicKey } },
    );
    return {
      acceptanceToken: data.presigned_acceptance.acceptance_token,
      termsUrl: data.presigned_acceptance.permalink,
      personalDataAuthToken: data.presigned_personal_data_auth.acceptance_token,
      personalDataUrl: data.presigned_personal_data_auth.permalink,
    };
  }

  async createPaymentSource(input: { token: string; customerEmail: string; acceptanceToken: string; acceptPersonalAuth: string }) {
    const data = await this.request<{ id: number }>('/payment_sources', this.private({
      type: 'CARD', token: input.token, customer_email: input.customerEmail, acceptance_token: input.acceptanceToken, accept_personal_auth: input.acceptPersonalAuth,
    }));
    return { id: String(data.id) };
  }

  async createTransaction(request: WompiTransactionRequest) {
    const data = await this.request<{ id: string; status: string; status_message?: string | null }>('/transactions', this.private(request));
    return { id: data.id, status: data.status, statusMessage: data.status_message ?? null };
  }

  private private(body: object): RequestInit {
    return { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${this.config.privateKey}`, 'content-type': 'application/json' } };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { type?: string; reason?: string; messages?: unknown } };
    if (!res.ok || !body.data) throw new WompiApiError(`Wompi ${res.status}: ${body.error?.reason ?? body.error?.type ?? 'sin detalle'}`);
    return body.data;
  }
}

/** Wompi simulado para desarrollo y tests (WOMPI_API=local). */
export class LocalWompiApi implements WompiApi {
  readonly sources: { token: string; customerEmail: string; acceptanceToken: string; acceptPersonalAuth: string }[] = [];
  readonly transactions: (WompiTransactionRequest & { id: string })[] = [];
  private status = 'PENDING';
  private failing = false;

  reset() {
    this.sources.length = 0;
    this.transactions.length = 0;
    this.status = 'PENDING';
    this.failing = false;
  }

  nextStatus(status: 'APPROVED' | 'DECLINED' | 'PENDING') {
    this.status = status;
  }

  failNext() {
    this.failing = true;
  }

  async getAcceptance(): Promise<WompiAcceptance> {
    return { acceptanceToken: 'acc_local', termsUrl: 'https://wompi.com/terminos-local.pdf', personalDataAuthToken: 'pda_local', personalDataUrl: 'https://wompi.com/datos-local.pdf' };
  }

  async createPaymentSource(input: { token: string; customerEmail: string; acceptanceToken: string; acceptPersonalAuth: string }) {
    this.sources.push(input);
    return { id: String(this.sources.length + 1000) };
  }

  async createTransaction(request: WompiTransactionRequest) {
    if (this.failing) {
      this.failing = false;
      throw new WompiApiError('Wompi no respondió (simulado)');
    }
    const id = `local-${randomBytes(6).toString('hex')}`;
    this.transactions.push({ ...request, id });
    return { id, status: this.status, statusMessage: this.status === 'DECLINED' ? 'Fondos insuficientes' : null };
  }
}
