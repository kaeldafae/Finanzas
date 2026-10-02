import { describe, expect, it } from 'vitest';
import { decodificar } from './leerArchivo';

const texto = 'Fecha\tConcepto\tImporte\n01/03/2026\tPeluquería\t-12,50\n';

function utf16le(t: string, bom: boolean): ArrayBuffer {
  const b = new Uint8Array((bom ? 2 : 0) + t.length * 2);
  let i = 0;
  if (bom) {
    b[i++] = 0xff;
    b[i++] = 0xfe;
  }
  for (const c of t) {
    const n = c.charCodeAt(0);
    b[i++] = n & 0xff;
    b[i++] = n >> 8;
  }
  return b.buffer;
}

describe('codificación de los archivos', () => {
  it('UTF-16 con y sin marca (Excel «Texto Unicode»)', () => {
    expect(decodificar(utf16le(texto, true))).toBe(texto);
    expect(decodificar(utf16le(texto, false))).toBe(texto);
  });

  it('UTF-8 y Windows-1252', () => {
    expect(decodificar(new TextEncoder().encode(texto).buffer)).toBe(texto);
    const cp1252 = new Uint8Array([0x50, 0x65, 0x6c, 0x75, 0x71, 0x75, 0x65, 0x72, 0xed, 0x61]);
    expect(decodificar(cp1252.buffer)).toBe('Peluquería');
  });
});
