import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

export class UnsafeUrlError extends Error {}

/** Rangos que no son internet público: red local, loopback, metadatos de la nube, multicast, reservados. */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96]] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return false;
  const mapped = family === 6 ? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip) : null;
  if (mapped) return isPublicAddress(mapped[1]!);
  return !PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * La validación va en el `lookup` del socket, no antes del request: así se valida la IP con la que
 * REALMENTE se conecta y un DNS que cambia entre chequeo y conexión (DNS rebinding) no la saltea.
 */
const safeLookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new UnsafeUrlError(`${hostname} apunta a una dirección que no es pública`));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}) as unknown as typeof dnsLookup;

export interface FetchedPage {
  url: string;
  contentType: string;
  body: string;
}
export type PageFetcher = (url: string) => Promise<FetchedPage>;

const TEXT_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml)/i;

/** E05-S02 — Descarga una página pública para la base de conocimiento: http(s), 2 MB, 10 s, 3 redirecciones. */
export async function fetchPublicPage(raw: string, { maxBytes = 2 * 1024 ** 2, timeoutMs = 10_000, redirects = 3 } = {}): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('La dirección no es una URL válida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Solo se aceptan direcciones http o https');
  if (url.username || url.password) throw new UnsafeUrlError('La dirección no puede llevar usuario ni contraseña');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError('La dirección no es pública');

  return new Promise<FetchedPage>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { lookup: safeLookup, timeout: timeoutMs, headers: { 'user-agent': 'BeeCRM-Conocimiento/1.0', accept: 'text/html,text/plain' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Demasiadas redirecciones'));
        return resolve(fetchPublicPage(new URL(res.headers.location, url).toString(), { maxBytes, timeoutMs, redirects: redirects - 1 }));
      }
      const contentType = res.headers['content-type'] ?? '';
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error(`La página respondió ${status}`));
      }
      if (!TEXT_TYPES.test(contentType)) {
        res.resume();
        return reject(new Error('La dirección no es una página de texto'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error('La página es demasiado grande'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ url: url.toString(), contentType, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('La página tardó demasiado en responder')));
    req.on('error', reject);
  });
}
