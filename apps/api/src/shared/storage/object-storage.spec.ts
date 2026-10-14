import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalDiskStorage } from './object-storage.js';

describe('LocalDiskStorage (E04-S06)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beecrm-storage-spec-'));
  const storage = new LocalDiskStorage(dir, 'k'.repeat(40), 'http://localhost:5173/');

  it('guarda, lee y borra con su tipo de contenido', async () => {
    await storage.put('t/empresa/m/audio', Buffer.from('OggS'), 'audio/ogg');
    expect(await storage.get('t/empresa/m/audio')).toEqual({ body: Buffer.from('OggS'), contentType: 'audio/ogg' });
    await storage.delete('t/empresa/m/audio');
    expect(await storage.get('t/empresa/m/audio')).toBeNull();
  });

  it('borra todo lo de una empresa', async () => {
    await storage.put('t/se-va/m/a', Buffer.from('a'), 'text/plain');
    await storage.put('t/se-queda/m/b', Buffer.from('b'), 'text/plain');
    await storage.deletePrefix('t/se-va');
    expect(existsSync(join(dir, 't', 'se-va'))).toBe(false);
    expect(await storage.get('t/se-queda/m/b')).not.toBeNull();
  });

  it('la URL firmada es de la app, verifica, y se rechaza si la alteran o venció', () => {
    const url = new URL(storage.signedUrl('t/empresa/r/reporte.csv', 60));
    expect(url.origin + url.pathname).toBe('http://localhost:5173/api/media/t/empresa/r/reporte.csv');
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature')!;
    expect(storage.verify('t/empresa/r/reporte.csv', expires, signature)).toBe(true);
    expect(storage.verify('t/otra/r/reporte.csv', expires, signature)).toBe(false);
    expect(storage.verify('t/empresa/r/reporte.csv', expires + 1, signature)).toBe(false);
    expect(storage.verify('t/empresa/r/reporte.csv', expires, 'falsa')).toBe(false);
    expect(storage.verify('t/empresa/r/reporte.csv', Math.floor(Date.now() / 1000) - 1, signature)).toBe(false);
  });

  it('una clave nunca sale de la carpeta de archivos', async () => {
    for (const key of ['../afuera', 't/../../etc/passwd', '/etc/passwd', 't\\..\\x', '']) {
      await expect(storage.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow(/inválida/);
      expect(storage.verify(key, Math.floor(Date.now() / 1000) + 60, 'x')).toBe(false);
    }
  });
});
