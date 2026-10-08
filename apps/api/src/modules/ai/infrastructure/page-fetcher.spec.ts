import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPublicPage, isPublicAddress, UnsafeUrlError } from './page-fetcher.js';

describe('Guardia SSRF (E05-S02, fuente URL)', () => {
  it.each([
    ['127.0.0.1', false], ['10.1.2.3', false], ['172.16.0.1', false], ['192.168.1.10', false], ['169.254.169.254', false],
    ['100.64.0.1', false], ['0.0.0.0', false], ['::1', false], ['fc00::1', false], ['fe80::1', false], ['::ffff:127.0.0.1', false],
    ['8.8.8.8', true], ['190.85.1.1', true], ['2800:3f0:4005:800::200e', true],
  ])('%s → pública: %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });

  describe('fetchPublicPage', () => {
    let port: number;
    const server = createServer((_req, res) => res.end('<p>interno</p>'));
    beforeAll(async () => {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('no entra a la red interna ni por IP ni por nombre', async () => {
      await expect(fetchPublicPage(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(fetchPublicPage(`http://localhost:${port}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(fetchPublicPage('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it('solo http y https, sin credenciales en la URL', async () => {
      await expect(fetchPublicPage('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(fetchPublicPage('ftp://example.com/x')).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(fetchPublicPage('https://user:pass@example.com/')).rejects.toBeInstanceOf(UnsafeUrlError);
    });
  });
});
