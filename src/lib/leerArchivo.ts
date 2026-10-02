import type { Celda } from '../domain/importacion/texto';
import { leerCsv } from '../domain/importacion/texto';

const MAX_BYTES = 10 * 1024 * 1024;

function aCelda(v: unknown): Celda {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  return null;
}

/**
 * Codificación del texto: UTF-16 (Excel «Texto Unicode»), UTF-8 o, si no es UTF-8 válido, Windows-1252
 * (algunos bancos exportan así las tildes y la ñ).
 */
export function decodificar(buffer: ArrayBuffer): string {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  // UTF-16 sin marca: muchos bytes nulos en posiciones impares (le) o pares (be).
  const muestra = b.subarray(0, 2000);
  let paresNulos = 0;
  let imparesNulos = 0;
  muestra.forEach((v, i) => {
    if (v !== 0) return;
    if (i % 2) imparesNulos++;
    else paresNulos++;
  });
  if (imparesNulos > muestra.length / 4) return new TextDecoder('utf-16le').decode(buffer);
  if (paresNulos > muestra.length / 4) return new TextDecoder('utf-16be').decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/**
 * Lee el extracto en el propio dispositivo. Nada se sube a ningún sitio.
 * Admite CSV (Revolut, la mayoría de bancos) y Excel .xlsx. Los PDF se leen aparte (leerPdf.ts).
 */
export async function leerArchivoBanco(archivo: File): Promise<Celda[][]> {
  if (archivo.size > MAX_BYTES) throw new Error('El archivo es demasiado grande para ser un extracto (máximo 10 MB).');
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.xls')) {
    throw new Error('Es un Excel antiguo (.xls). Descárgalo en CSV, o ábrelo y guárdalo como .xlsx.');
  }
  if (nombre.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    const filas: unknown[][] = await readSheet(archivo);
    return filas.map((r) => r.map(aCelda));
  }
  return leerCsv(decodificar(await archivo.arrayBuffer()));
}
