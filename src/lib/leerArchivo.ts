import type { Celda } from '../domain/importacion/texto';
import { leerCsv } from '../domain/importacion/texto';

const MAX_BYTES = 10 * 1024 * 1024;

function aCelda(v: unknown): Celda {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  return null;
}

/** Algunos bancos exportan CSV en Windows-1252 (tildes y ñ). Se prueba UTF-8 estricto y, si falla, Windows-1252. */
function decodificar(buffer: ArrayBuffer): string {
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
