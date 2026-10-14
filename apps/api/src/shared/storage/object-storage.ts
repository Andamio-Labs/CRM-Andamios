import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export interface StoredFile {
  body: Buffer;
  contentType: string;
}

/**
 * E04-S06 — Puerto de archivos (multimedia de WhatsApp, importaciones, avatares). Local: disco
 * (STORAGE_DIR); en la nube, S3 con el mismo puerto. Las claves de una empresa empiezan con `t/<tenant>/`.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
  /** Borra todo lo que empieza con el prefijo: `t/<tenant>` al eliminar la empresa (E13-S04). */
  deletePrefix(prefix: string): Promise<void>;
  /** URL absoluta y firmada que vence sola: sirve para <audio>, <img> o descargar sin sesión. */
  signedUrl(key: string, ttlSeconds?: number): string;
  verify(key: string, expires: number, signature: string): boolean;
}

export const DEFAULT_URL_TTL_SECONDS = 15 * 60;

/** Solo segmentos simples: nada de "..", rutas absolutas ni barras invertidas. */
const SAFE_KEY = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[\w.-]+(?:\/[\w.-]+)*$/;

export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  /**
   * `publicUrl` es el origen de la app: la web habla con la API por el mismo origen (/api pasa por el
   * proxy), y helmet bloquea recursos servidos desde otro origen.
   */
  constructor(dir: string, private readonly signingKey: string, private readonly publicUrl: string) {
    this.root = resolve(dir);
  }

  async put(key: string, body: Buffer, contentType: string) {
    const file = this.fileFor(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(`${file}.content-type`, contentType);
  }

  async get(key: string): Promise<StoredFile | null> {
    const file = this.fileFor(key);
    try {
      const [body, contentType] = await Promise.all([readFile(file), readFile(`${file}.content-type`, 'utf8')]);
      return { body, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string) {
    const file = this.fileFor(key);
    await rm(file, { force: true });
    await rm(`${file}.content-type`, { force: true });
  }

  async deletePrefix(prefix: string) {
    await rm(this.fileFor(prefix), { recursive: true, force: true });
  }

  signedUrl(key: string, ttlSeconds = DEFAULT_URL_TTL_SECONDS) {
    this.fileFor(key);
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const query = new URLSearchParams({ expires: String(expires), signature: this.sign(key, expires) });
    return `${this.publicUrl.replace(/\/+$/, '')}/api/media/${key.split('/').map(encodeURIComponent).join('/')}?${query}`;
  }

  verify(key: string, expires: number, signature: string) {
    if (!SAFE_KEY.test(key) || !Number.isInteger(expires) || expires < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(key, expires));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private sign(key: string, expires: number) {
    return createHmac('sha256', this.signingKey).update(`${key}\n${expires}`).digest('base64url');
  }

  /** La clave nunca sale de la carpeta de archivos, aunque venga de una URL. */
  private fileFor(key: string) {
    if (!SAFE_KEY.test(key)) throw new Error(`Clave de archivo inválida: ${key}`);
    const file = resolve(this.root, ...key.split('/'));
    if (!file.startsWith(this.root + sep)) throw new Error(`Clave de archivo inválida: ${key}`);
    return file;
  }
}
