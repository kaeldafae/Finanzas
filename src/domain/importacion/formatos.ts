import type { Centimos } from '../dinero';
import type { MetodoLectura } from '../modelo';
import { cuadrar } from './cuadre';
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
  /** Página del PDF de la que sale (evidencia). */
  pagina?: number;
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
  /** El banco pone los cargos en positivo en la única columna de importe. */
  invertir?: boolean;
}

/** Cómo se han encontrado las columnas, para explicarlo en pantalla. */
export type Deteccion = MetodoLectura;

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
  deteccion: Deteccion;
  /** Lecturas probadas y por qué se aceptó o rechazó cada una (sin datos). */
  hipotesis?: string[];
}

const SINONIMOS = {
  fechaPreferida: ['completed date', 'fecha de finalizacion', 'fecha operacion', 'f. operacion', 'fecha de operacion', 'fecha operación'],
  fecha: ['fecha', 'date', 'started date', 'fecha de inicio', 'fecha valor', 'f. valor'],
  concepto: ['concepto', 'descripcion', 'description', 'detalle', 'movimiento', 'concepto ampliado'],
  importe: ['importe', 'amount', 'cantidad', 'importe eur', 'importe (eur)', 'importe euros'],
  cargo: ['cargo', 'cargos', 'debe', 'gasto', 'dinero saliente', 'money out', 'paid out', 'debito', 'débito'],
  abono: ['abono', 'abonos', 'haber', 'ingreso', 'dinero entrante', 'money in', 'paid in', 'credito', 'crédito'],
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

export function extraerMovimientos(filas: readonly (readonly Celda[])[], mapeo: Mapeo, deteccion: Deteccion = 'cabeceras'): LecturaExtracto {
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
    if (mapeo.importe !== null) {
      importe = parsearImporteBanco(celda(r, mapeo.importe), mapeo.decimal);
      if (importe !== null && mapeo.invertir) importe = -importe;
    } else {
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
  return { formato, banco, movimientos, descartados, cabeceras, mapeo: { ...mapeo, formato }, deteccion };
}

/**
 * Lee un extracto ya convertido a filas. Primero por los títulos de las columnas; si no los reconoce,
 * por el contenido, verificando con el saldo. null si no hay una lectura segura.
 */
export function leerExtracto(filas: readonly (readonly Celda[])[]): LecturaExtracto | null {
  const mapeo = detectarMapeo(filas);
  if (mapeo) return extraerMovimientos(filas, mapeo);
  return inferirPorContenido(filas);
}

// --- Detección por contenido -----------------------------------------------------------------

interface PerfilColumna {
  indice: number;
  llenas: number;
  fechas: number;
  importes: number;
  distintos: number;
  decimal: SeparadorDecimal;
}

const MUESTRA = 400;

/** Primera fila con una fecha y un importe: ahí empiezan los movimientos. */
function inicioDatos(filas: readonly (readonly Celda[])[]): number {
  for (let f = 0; f < Math.min(filas.length, 60); f++) {
    const r = filas[f] ?? [];
    const fecha = r.some((c) => parsearFecha(c) !== null);
    const importe = r.some((c) => typeof c === 'number' || (typeof c === 'string' && /\d[.,]\d{2}\s*(€|EUR)?\s*-?$/i.test(c.trim())));
    if (fecha && importe) return f;
  }
  return -1;
}

function perfilar(datos: readonly (readonly Celda[])[]): PerfilColumna[] {
  const ancho = Math.max(0, ...datos.map((r) => r.length));
  const perfiles: PerfilColumna[] = [];
  for (let j = 0; j < ancho; j++) {
    const valores = datos.map((r) => r[j] ?? null).filter((c) => c !== null && textoCelda(c).trim() !== '');
    const decimal = deducirDecimal(valores);
    perfiles.push({
      indice: j,
      llenas: valores.length,
      fechas: valores.filter((c) => parsearFecha(c) !== null).length,
      importes: valores.filter((c) => !(c instanceof Date) && parsearImporteBanco(c, decimal) !== null).length,
      distintos: new Set(valores.map((c) => textoCelda(c))).size,
      decimal,
    });
  }
  return perfiles;
}

function firma(l: LecturaExtracto): string {
  return l.movimientos.map((m) => `${m.fecha}${m.importe}`).join('|');
}

/**
 * Elige las columnas mirando lo que contienen: la de fechas, las de importes y la de texto más variado.
 * Prueba las combinaciones posibles (importe con o sin signo, cargo y abono separados, cuál es el saldo)
 * y solo acepta la que cuadra al céntimo con el saldo del banco. Sin saldo, solo si no hay ninguna duda.
 */
export function inferirPorContenido(filas: readonly (readonly Celda[])[]): LecturaExtracto | null {
  const inicio = inicioDatos(filas);
  if (inicio < 0) return null;
  const datos = filas.slice(inicio, inicio + MUESTRA);
  const perfiles = perfilar(datos);
  const n = datos.length;
  const fecha = perfiles.find((p) => p.llenas >= n * 0.9 && p.fechas >= p.llenas * 0.9);
  if (!fecha) return null;
  const numericas = perfiles.filter((p) => p !== fecha && p.llenas > 0 && p.importes >= p.llenas * 0.9 && p.fechas < p.llenas * 0.5);
  const texto = perfiles
    .filter((p) => p !== fecha && !numericas.includes(p) && p.llenas >= n * 0.5 && p.fechas < p.llenas * 0.5)
    .sort((a, b) => b.distintos - a.distintos)[0];
  if (!texto || numericas.length === 0) return null;

  const base: Mapeo = {
    formato: 'generico', filaCabecera: inicio - 1, fecha: fecha.indice, concepto: texto.indice, importe: null, cargo: null, abono: null,
    saldo: null, divisa: null, tipo: null, producto: null, estado: null, comision: null, decimal: ',',
  };
  const candidatos: Mapeo[] = [];
  const saldos: (PerfilColumna | null)[] = [...numericas.filter((p) => p.llenas >= n * 0.9), null];
  for (const saldo of saldos) {
    const resto = numericas.filter((p) => p !== saldo);
    for (const imp of resto) {
      for (const invertir of [false, true]) {
        candidatos.push({ ...base, importe: imp.indice, decimal: imp.decimal, saldo: saldo?.indice ?? null, invertir });
      }
    }
    // Cargo y abono en columnas separadas: casi nunca hay valor en las dos a la vez.
    for (const cargo of resto) {
      for (const abono of resto) {
        if (cargo === abono || cargo.llenas + abono.llenas > n * 1.05) continue;
        candidatos.push({ ...base, cargo: cargo.indice, abono: abono.indice, decimal: cargo.decimal, saldo: saldo?.indice ?? null });
      }
    }
  }

  const verificadas: LecturaExtracto[] = [];
  const sinSaldo: LecturaExtracto[] = [];
  let probadas = 0;
  for (const m of candidatos) {
    const l = extraerMovimientos(filas, m, 'contenido');
    probadas++;
    if (l.movimientos.length === 0 || l.descartados.length > l.movimientos.length * 0.1) continue;
    const c = cuadrar(l.movimientos);
    if (m.saldo !== null && c.estado === 'ok' && c.comprobados > 0) verificadas.push(l);
    else if (m.saldo === null && !m.invertir) sinSaldo.push(l);
  }
  if (verificadas.length > 0) {
    // Varias combinaciones que cuadran solo valen si leen exactamente los mismos movimientos.
    const primera = verificadas[0];
    if (!primera || !verificadas.every((l) => firma(l) === firma(primera))) return null;
    return { ...primera, hipotesis: [`${probadas} combinaciones de columnas probadas; ${verificadas.length} cuadra(n) con el saldo y leen lo mismo: aceptada.`] };
  }
  // Sin saldo para comprobar: solo si hay una única columna de importes con signo.
  if (numericas.length === 1 && sinSaldo.length >= 1) {
    const l = sinSaldo.find((x) => x.mapeo.importe !== null);
    if (l && l.movimientos.some((m) => m.importe < 0) && l.movimientos.some((m) => m.importe > 0)) {
      return { ...l, hipotesis: ['Sin columna de saldo: una única columna de importes con signo (no se puede verificar al céntimo).'] };
    }
  }
  return null;
}

/**
 * Descripción de la estructura del archivo SIN datos: ni importes, ni conceptos, ni fechas.
 * Sirve para pedir ayuda si un banco no se reconoce, sin revelar movimientos.
 */
export function diagnosticoAnonimo(filas: readonly (readonly Celda[])[]): string {
  const inicio = inicioDatos(filas);
  const datos = inicio >= 0 ? filas.slice(inicio, inicio + MUESTRA) : filas.slice(0, MUESTRA);
  const perfiles = perfilar(datos);
  const tipo = (p: PerfilColumna) => {
    if (p.llenas === 0) return 'vacía';
    if (p.fechas >= p.llenas * 0.9) return 'fecha';
    if (p.importes >= p.llenas * 0.9) return `importe (decimal "${p.decimal}", ${Math.round((p.llenas / Math.max(1, datos.length)) * 100)} % llena)`;
    return 'texto';
  };
  const cab = inicio > 0 ? (filas[inicio - 1] ?? []).map(textoCelda).map((c) => (/\d/.test(c) || c.length > 30 ? '…' : c)) : [];
  // Forma de las primeras filas: letras → "a", números → "9". Se ve la estructura (separadores, comillas), no los datos.
  const forma = (r: readonly Celda[]) => r.map((c) => textoCelda(c).replace(/\p{L}/gu, 'a').replace(/\d/g, '9').slice(0, 40)).join(' ¦ ').slice(0, 160);
  const primeras = filas.filter((r) => r.some((c) => textoCelda(c).trim() !== '')).slice(0, 4);
  return [
    `Filas: ${filas.length} · columnas por fila: ${[...new Set(filas.slice(0, 60).map((r) => r.length))].join(', ')} · inicio de datos: ${inicio >= 0 ? `fila ${inicio + 1}` : 'no encontrado'}`,
    `Títulos: ${cab.length ? cab.join(' | ') : 'sin fila de títulos'}`,
    ...perfiles.map((p) => `Columna ${p.indice + 1}: ${tipo(p)}`),
    'Forma de las primeras filas (letras → a, números → 9):',
    ...primeras.map((r) => `  ${forma(r)}`),
  ].join('\n');
}

/** Cabeceras candidatas para el mapeo manual: la primera fila con al menos 3 celdas de texto. */
export function cabecerasCandidatas(filas: readonly (readonly Celda[])[]): { fila: number; cabeceras: string[] } | null {
  for (let f = 0; f < Math.min(filas.length, 40); f++) {
    const cab = (filas[f] ?? []).map(textoCelda);
    if (cab.filter((c) => c.trim() !== '' && !/^[-\d.,\s€]+$/.test(c)).length >= 3) return { fila: f, cabeceras: cab };
  }
  return null;
}
