import type { MovimientoBruto } from './formatos';
import { normalizarTexto } from './texto';

async function sha256(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Huella de cada movimiento para no importarlo dos veces (mismo archivo o extractos que se solapan).
 * Es un hash: no permite reconstruir el concepto. Dos movimientos idénticos el mismo día
 * (dos cafés de 1,50 €) reciben huellas distintas por su número de aparición.
 */
export async function huellas(cuenta: string, movimientos: readonly MovimientoBruto[]): Promise<string[]> {
  const vistos = new Map<string, number>();
  const out: string[] = [];
  for (const m of movimientos) {
    const base = `${normalizarTexto(cuenta)}|${m.fecha}|${m.importe}|${normalizarTexto(m.concepto)}`;
    const n = vistos.get(base) ?? 0;
    vistos.set(base, n + 1);
    out.push(await sha256(`${base}|${n}`));
  }
  return out;
}

/**
 * Clave sin el texto del concepto: misma cuenta, mismo día y mismo importe. Sirve para reconocer un movimiento
 * ya importado desde otro formato (el PDF y el CSV de un banco escriben el concepto de forma distinta).
 */
export function claveSuelta(cuenta: string, fecha: string, importe: number): string {
  return `${normalizarTexto(cuenta)}|${fecha}|${importe}`;
}
