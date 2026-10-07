export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    /** Cuerpo completo del error (p. ej. `duplicates` en DUPLICATE_CONTACT). */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** fetch a la API propia (mismo origen). Lanza ApiError con el `code` estable del backend. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.code, body.message ?? `HTTP ${res.status}`, body);
  return body as T;
}
