/**
 * Importes en céntimos (enteros) y tasas en diezmilésimas (enteros).
 *
 *  - 12,34 €  → 1234 céntimos
 *  - 9,5 %    → 950 diezmilésimas (0,095)
 *  - 1,75     → 17500 diezmilésimas (coeficiente)
 *
 * Nunca se opera con floats en euros: toda multiplicación pasa por `aplicarTasa`,
 * que redondea una única vez al céntimo (redondeo comercial, mitad hacia arriba
 * en valor absoluto).
 */

export type Centimos = number;
export type Tasa = number;

export const TASA_UNIDAD = 10_000;

/** Límite de seguridad: 10 millones de euros. Evita desbordar Number.MAX_SAFE_INTEGER al multiplicar por tasas. */
export const MAX_CENTIMOS = 1_000_000_000;

export function euros(valor: number): Centimos {
  return Math.round(valor * 100);
}

/** División entera con redondeo comercial (mitad lejos de cero). */
export function dividirRedondeando(numerador: number, divisor: number): number {
  if (!Number.isInteger(numerador) || !Number.isInteger(divisor) || divisor <= 0) {
    throw new RangeError('dividirRedondeando requiere enteros y divisor positivo');
  }
  const signo = numerador < 0 ? -1 : 1;
  const abs = Math.abs(numerador);
  const cociente = Math.floor(abs / divisor);
  const resto = abs - cociente * divisor;
  const redondeado = resto * 2 >= divisor ? cociente + 1 : cociente;
  return signo * redondeado || 0;
}

/** importe × tasa, redondeado al céntimo. */
export function aplicarTasa(importe: Centimos, tasa: Tasa): Centimos {
  return dividirRedondeando(importe * tasa, TASA_UNIDAD);
}

export function sumar(valores: readonly Centimos[]): Centimos {
  let total = 0;
  for (const v of valores) total += v;
  return total;
}

export type ResultadoParseo =
  | { ok: true; valor: number }
  | { ok: false; error: string };

/**
 * Convierte texto escrito por una persona en España a entero escalado.
 * Acepta "1.234,56", "1234,56", "1234.56", "2.200" (miles), "12", "0,5".
 * `decimales` indica cuántos decimales caben (2 para euros y porcentajes, 4 para coeficientes).
 */
export function parsearDecimal(texto: string, decimales: number, maximo: number = MAX_CENTIMOS): ResultadoParseo {
  const limpio = texto.replace(/[\s\u00a0€%]/g, '');
  if (limpio === '') return { ok: false, error: 'Escribe un número' };
  if (limpio.startsWith('-')) return { ok: false, error: 'No se admiten negativos' };

  let entera: string;
  let fraccion: string;
  if (limpio.includes(',')) {
    const m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d*)$/.exec(limpio) ?? /^(\d{1,3}(?:\.\d{3})+|\d+)$/.exec(limpio);
    if (!m) return { ok: false, error: 'Formato no válido. Ejemplo: 1.234,56' };
    entera = (m[1] ?? '').replace(/\./g, '');
    fraccion = m[2] ?? '';
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(limpio)) {
    entera = limpio.replace(/\./g, '');
    fraccion = '';
  } else {
    const m = /^(\d+)(?:\.(\d*))?$/.exec(limpio);
    if (!m) return { ok: false, error: 'Formato no válido. Ejemplo: 1.234,56' };
    entera = m[1] ?? '';
    fraccion = m[2] ?? '';
  }

  if (fraccion.length > decimales) {
    return { ok: false, error: decimales === 0 ? 'Sin decimales' : `Máximo ${decimales} decimales` };
  }
  const escala = 10 ** decimales;
  const valor = Number(entera) * escala + Number(fraccion.padEnd(decimales, '0') || '0');
  if (!Number.isSafeInteger(valor) || valor > maximo) {
    return { ok: false, error: 'Valor demasiado grande' };
  }
  return { ok: true, valor };
}

export function parsearEuros(texto: string): ResultadoParseo {
  return parsearDecimal(texto, 2);
}

/** "9,5" → 950 (diezmilésimas). */
export function parsearPorcentaje(texto: string): ResultadoParseo {
  return parsearDecimal(texto, 2, TASA_UNIDAD);
}

/** "1,75" → 17500 (diezmilésimas). */
export function parsearCoeficiente(texto: string): ResultadoParseo {
  return parsearDecimal(texto, 4, 100 * TASA_UNIDAD);
}

const formatoEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const formatoNumero = (decimales: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: decimales, useGrouping: true });

const formatoCifra = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Sin símbolo de moneda, para tablas estrechas con "(€)" en la cabecera. */
export function formatearCifra(c: Centimos): string {
  return formatoCifra.format(c / 100);
}

export function formatearEuros(c: Centimos): string {
  // Intl formatea floats; la división /100 de un entero es exacta para mostrar.
  return formatoEuros.format(c / 100);
}

/** Para rellenar inputs editables: 123456 → "1234,56" (sin separador de miles para no confundir al editar). */
export function centimosATexto(c: Centimos): string {
  const signo = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  const e = Math.floor(abs / 100);
  const f = abs % 100;
  return f === 0 ? `${signo}${e}` : `${signo}${e},${String(f).padStart(2, '0')}`;
}

/** Entero escalado → texto editable con coma: (950, 2) → "9,5"; (17500, 4) → "1,75". */
function escaladoATexto(valor: number, decimales: number): string {
  const escala = 10 ** decimales;
  const e = Math.floor(valor / escala);
  const f = String(valor % escala).padStart(decimales, '0').replace(/0+$/, '');
  return f === '' ? String(e) : `${e},${f}`;
}

/** Porcentaje editable: 950 → "9,5". */
export function tasaATexto(t: Tasa): string {
  return escaladoATexto(t, 2);
}

/** Coeficiente editable: 17500 → "1,75". */
export function coeficienteATexto(t: Tasa): string {
  return escaladoATexto(t, 4);
}

export function formatearPorcentaje(t: Tasa): string {
  return `${formatoNumero(2).format(t / 100)} %`;
}
