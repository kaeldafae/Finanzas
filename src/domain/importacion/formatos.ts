import type { Centimos } from '../dinero';
import { deducirDecimal, normalizarTexto, parsearFecha, parsearImporteBanco, type Celda, type SeparadorDecimal } from './texto';

/** Movimiento leído del extracto, antes de clasificar. El concepto solo vive en memoria durante la importación. */
export interface MovimientoBruto {
  /** Posición en el archivo (para mensajes y para el orden del cuadre). */
  fila: number;
  fecha: string;
  concepto: string;
  /** Con signo: negativo sale de la cuenta. Sin incluir la comisión. */
  importe: Centimos;
  /** Comisión cobrada aparte (Revolut), siempre ≥ 0. */
  comision: Centimos;
  saldo: Centimos | null;
  /** Tipo de operación según el banco (Revolut: CARD_PAYMENT, TOPUP, ATM...). */
  tipoBanco: string | null;
  /** Producto de Revolut (cuenta corriente, ahorro/hucha...). */
  producto: string | null;
}

export type FormatoBanco = 'revolut' | 'santander' | 'generico';

export interface Mapeo {
  formato: FormatoBanco;
  filaCabecera: number;
  fecha: number;
  concepto: number;
  /** Una columna de importe con signo, o dos columnas (cargo / abono). */
  importe: number | null;
  cargo: number | null;
  abono: number | null;
  saldo: number | null;
  divisa: number | null;
  tipo: number | null;
  producto: number | null;
  estado: number | null;
  comision: number | null;
  decimal: SeparadorDecimal;
}

export interface Descartado {
  fila: number;
  motivo: string;
}

export interface LecturaExtracto {
  formato: FormatoBanco;
  /** Nombre propuesto para la cuenta (editable). */
  banco: string;
  movimientos: MovimientoBruto[];
  descartados: Descartado[];
  cabeceras: string[];
  mapeo: Mapeo;
}

const SINONIMOS = {
  fechaPreferida: ['completed date', 'fecha de finalizacion', 'fecha operacion', 'f. operacion', 'fecha de operacion', 'fecha operación'],
  fecha: ['fecha', 'date', 'started date', 'fecha de inicio', 'fecha valor', 'f. valor'],
  concepto: ['concepto', 'descripcion', 'description', 'detalle', 'movimiento', 'concepto ampliado'],
  importe: ['importe', 'amount', 'cantidad', 'importe eur', 'importe (eur)', 'importe euros'],
  cargo: ['cargo', 'cargos', 'debe', 'gasto'],
  abono: ['abono', 'abonos', 'haber', 'ingreso'],
  saldo: ['saldo', 'balance', 'saldo eur', 'saldo (eur)', 'saldo disponible'],
  divisa: ['divisa', 'currency', 'moneda'],
  tipo: ['type', 'tipo'],
  producto: ['product', 'producto'],
  estado: ['state', 'estado'],
  comision: ['fee', 'comision', 'comisión'],
} as const;

function columna(cabeceras: readonly string[], sinonimos: readonly string[]): number | null {
  const norm = cabeceras.map(normalizarTexto);
  for (const s of sinonimos) {
    const i = norm.indexOf(normalizarTexto(s));
    if (i >= 0) return i;
  }
  return null;
}

function textoCelda(c: Celda | undefined): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString();
  return String(c);
}

/** Busca la fila de cabeceras en las primeras filas (los bancos suelen poner título, titular y fechas antes). */
export function detectarMapeo(filas: readonly (readonly Celda[])[]): Mapeo | null {
  for (let f = 0; f < Math.min(filas.length, 40); f++) {
    const cab = (filas[f] ?? []).map(textoCelda);
    const fecha = columna(cab, SINONIMOS.fechaPreferida) ?? columna(cab, SINONIMOS.fecha);
    const concepto = columna(cab, SINONIMOS.concepto);
    const importe = columna(cab, SINONIMOS.importe);
    const cargo = columna(cab, SINONIMOS.cargo);
    const abono = columna(cab, SINONIMOS.abono);
    if (fecha === null || concepto === null || (importe === null && (cargo === null || abono === null))) continue;
    const tipo = columna(cab, SINONIMOS.tipo);
    const producto = columna(cab, SINONIMOS.producto);
    const esRevolut = tipo !== null && producto !== null;
    const columnaImportes = importe ?? cargo ?? 0;
    const muestra = filas.slice(f + 1, f + 60).map((r) => r[columnaImportes] ?? null);
    return {
      formato: esRevolut ? 'revolut' : 'generico',
      filaCabecera: f,
      fecha,
      concepto,
      importe,
      cargo: importe === null ? cargo : null,
      abono: importe === null ? abono : null,
      saldo: columna(cab, SINONIMOS.saldo),
      divisa: columna(cab, SINONIMOS.divisa),
      tipo: esRevolut ? tipo : null,
      producto: esRevolut ? producto : null,
      estado: esRevolut ? columna(cab, SINONIMOS.estado) : null,
      comision: esRevolut ? columna(cab, SINONIMOS.comision) : null,
      decimal: deducirDecimal(muestra),
    };
  }
  return null;
}

function nombreBanco(filas: readonly (readonly Celda[])[], mapeo: Mapeo): { formato: FormatoBanco; banco: string } {
  if (mapeo.formato === 'revolut') return { formato: 'revolut', banco: 'Revolut' };
  const antes = filas.slice(0, mapeo.filaCabecera + 1).flat().map(textoCelda).join(' ').toLowerCase();
  if (antes.includes('santander')) return { formato: 'santander', banco: 'Santander' };
  return { formato: 'generico', banco: 'Cuenta' };
}

const COMPLETADO = new Set(['completed', 'completado', 'completada']);

export function extraerMovimientos(filas: readonly (readonly Celda[])[], mapeo: Mapeo): LecturaExtracto {
  const movimientos: MovimientoBruto[] = [];
  const descartados: Descartado[] = [];
  const cabeceras = (filas[mapeo.filaCabecera] ?? []).map(textoCelda);
  const celda = (r: readonly Celda[], i: number | null): Celda => (i === null ? null : (r[i] ?? null));

  for (let f = mapeo.filaCabecera + 1; f < filas.length; f++) {
    const r = filas[f] ?? [];
    const numFila = f + 1;
    if (r.every((c) => c === null || textoCelda(c).trim() === '')) continue;

    // Primero el estado: las operaciones pendientes o anuladas de Revolut no tienen fecha de finalización.
    const estado = textoCelda(celda(r, mapeo.estado)).trim().toLowerCase();
    if (mapeo.estado !== null && estado !== '' && !COMPLETADO.has(estado)) {
      descartados.push({ fila: numFila, motivo: `Operación no completada (${estado})` });
      continue;
    }

    const fecha = parsearFecha(celda(r, mapeo.fecha));
    // Filas de totales o pies de página: sin fecha válida y sin importe.
    let importe: Centimos | null;
    if (mapeo.importe !== null) importe = parsearImporteBanco(celda(r, mapeo.importe), mapeo.decimal);
    else {
      const cargo = parsearImporteBanco(celda(r, mapeo.cargo), mapeo.decimal);
      const abono = parsearImporteBanco(celda(r, mapeo.abono), mapeo.decimal);
      importe = cargo === null && abono === null ? null : (abono ?? 0) - Math.abs(cargo ?? 0);
    }
    if (!fecha && importe === null) continue;
    if (!fecha) {
      descartados.push({ fila: numFila, motivo: 'Fecha no válida' });
      continue;
    }
    if (importe === null) {
      descartados.push({ fila: numFila, motivo: 'Importe no válido' });
      continue;
    }

    const divisa = textoCelda(celda(r, mapeo.divisa)).trim().toUpperCase();
    if (divisa !== '' && divisa !== 'EUR') {
      descartados.push({ fila: numFila, motivo: `En otra divisa (${divisa}): no se suma a los euros` });
      continue;
    }

    movimientos.push({
      fila: numFila,
      fecha,
      concepto: textoCelda(celda(r, mapeo.concepto)).replace(/\s+/g, ' ').trim(),
      importe,
      comision: Math.abs(parsearImporteBanco(celda(r, mapeo.comision), mapeo.decimal) ?? 0),
      saldo: parsearImporteBanco(celda(r, mapeo.saldo), mapeo.decimal),
      tipoBanco: textoCelda(celda(r, mapeo.tipo)).trim().toUpperCase() || null,
      producto: textoCelda(celda(r, mapeo.producto)).trim() || null,
    });
  }
  const { formato, banco } = nombreBanco(filas, mapeo);
  return { formato, banco, movimientos, descartados, cabeceras, mapeo: { ...mapeo, formato } };
}

/** Lee un extracto ya convertido a filas. null si no se reconocen las columnas (habrá que elegirlas a mano). */
export function leerExtracto(filas: readonly (readonly Celda[])[]): LecturaExtracto | null {
  const mapeo = detectarMapeo(filas);
  return mapeo ? extraerMovimientos(filas, mapeo) : null;
}

/** Cabeceras candidatas para el mapeo manual: la primera fila con al menos 3 celdas de texto. */
export function cabecerasCandidatas(filas: readonly (readonly Celda[])[]): { fila: number; cabeceras: string[] } | null {
  for (let f = 0; f < Math.min(filas.length, 40); f++) {
    const cab = (filas[f] ?? []).map(textoCelda);
    if (cab.filter((c) => c.trim() !== '' && !/^[-\d.,\s€]+$/.test(c)).length >= 3) return { fila: f, cabeceras: cab };
  }
  return null;
}
