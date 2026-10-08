import { describe, expect, it } from 'vitest';
import { htmlToText } from './web-page.js';

describe('htmlToText (E05-S02, fuente URL)', () => {
  it('saca el título y el texto legible, sin scripts, estilos ni menús', () => {
    const html = `<html><head><title>Andamios &amp; Cía</title><style>p{}</style><script>alert(1)</script></head>
      <body><nav>Inicio | Contacto</nav><h1>Alquiler</h1><p>El andamio cuesta&nbsp;$1.200.000.</p>
      <ul><li>Entrega en Bogot&#225;</li><li>Montaje incluido</li></ul><footer>© 2026</footer></body></html>`;
    const page = htmlToText(html);
    expect(page.title).toBe('Andamios & Cía');
    expect(page.text).toContain('Alquiler');
    expect(page.text).toContain('El andamio cuesta $1.200.000.');
    expect(page.text).toContain('Entrega en Bogotá');
    expect(page.text).not.toMatch(/alert|Inicio \| Contacto|p\{\}|© 2026/);
  });

  it('separa bloques en párrafos para que el troceado los respete', () => {
    expect(htmlToText('<p>Uno</p><p>Dos</p>').text).toBe('Uno\n\nDos');
  });
});
