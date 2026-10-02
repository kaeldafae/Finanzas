import type { Centimos } from '../dinero';
import { extraerMovimientos, type Descartado, type LecturaExtracto, type Mapeo } from './formatos';
import { cuadrar } from './cuadre';
import { deducirDecimal, normalizarTexto, parsearFecha, parsearImporteBanco } from './texto';

/**
 * Lectura de extractos en PDF a partir de la posición de cada texto en la página (no hay OCR ni IA:
 * lo que no está escrito como texto en el PDF no se lee). Las columnas se localizan por sus títulos
 * y cada importe se asigna a la columna con la que está alineado.
 */

/** Un fragmento de texto del PDF con su posición (puntos PDF, y crece hacia arriba). */
export interface TextoPdf {
  texto: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  pagina: number;
}

interface Celda {
  texto: string;
  x0: number;
  x1: number;
}

interface Linea {
  pagina: number;
  y: number;
  alto: number;
  celdas: Celda[];
  texto: string;
}

type Rol = 'fecha' | 'concepto' | 'cargo' | 'abono' | 'importe' | 'saldo';

interface Columna {
  rol: Rol;
  x0: number;
  x1: number;
}

/** Resumen que los bancos ponen al principio del extracto (Revolut: "Resumen del saldo"). */
export interface ResumenPdf {
  /** Producto de la fila del resumen ("Cuenta (Corriente)", "Hucha Viaje"...). */
  etiqueta: string;
  inicial: Centimos;
  salidas: Centimos;
  entradas: Centimos;
  final: Centimos;
}

export interface ControlResumen {
  resumen: ResumenPdf;
  /** Lo que suman los movimientos leídos. */
  entradas: Centimos;
  salidas: Centimos;
  ok: boolean;
}

export interface LecturaPdf {
  lectura: LecturaExtracto | null;
  control: ControlResumen | null;
  diagnostico: string;
}

// --- Líneas y celdas -------------------------------------------------------------------------

function agruparLineas(textos: readonly TextoPdf[]): Linea[] {
  const items = textos.filter((t) => t.texto.trim() !== '').sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);
  const lineas: { pagina: number; y: number; alto: number; items: TextoPdf[] }[] = [];
  for (const t of items) {
    const ultima = lineas[lineas.length - 1];
    const tolerancia = Math.max(2, Math.min(t.alto, ultima?.alto ?? t.alto) * 0.45);
    if (ultima && ultima.pagina === t.pagina && Math.abs(ultima.y - t.y) <= tolerancia) {
      ultima.items.push(t);
      ultima.alto = Math.max(ultima.alto, t.alto);
    } else lineas.push({ pagina: t.pagina, y: t.y, alto: t.alto || 8, items: [t] });
  }
  return lineas.map((l) => {
    const ordenados = [...l.items].sort((a, b) => a.x - b.x);
    const celdas: Celda[] = [];
    for (const t of ordenados) {
      const previa = celdas[celdas.length - 1];
      const hueco = previa ? t.x - previa.x1 : Infinity;
      // Separación mayor que ~un carácter ancho: es otra columna.
      if (previa && hueco < Math.max(3, l.alto * 0.8)) {
        previa.texto += hueco > l.alto * 0.12 ? ` ${t.texto.trim()}` : t.texto.trim();
        previa.x1 = Math.max(previa.x1, t.x + t.ancho);
      } else celdas.push({ texto: t.texto.trim(), x0: t.x, x1: t.x + t.ancho });
    }
    return { pagina: l.pagina, y: l.y, alto: l.alto, celdas, texto: celdas.map((c) => c.texto).join(' ') };
  });
}

// --- Cabeceras -------------------------------------------------------------------------------

/** Títulos de columna. Se buscan dentro del texto: pdf.js puede dar varios títulos en un mismo fragmento. */
const TITULOS: readonly [Rol, RegExp][] = [
  ['fecha', /\b(fecha(\s+de\s+(operacion|inicio|finalizacion|valor))?|date|completed\s+date|f\.\s?operacion)\b/g],
  ['concepto', /\b(descripcion|description|concepto|detalle|details)\b/g],
  ['cargo', /\b(dinero\s+saliente|money\s+out|paid\s+out|cargos?|debe|debitos?|retiradas?|withdrawals?|salidas?)\b/g],
  ['abono', /\b(dinero\s+entrante|money\s+in|paid\s+in|abonos?|haber|creditos?|ingresos?|deposits?|entradas?)\b/g],
  ['importe', /\b(importe|amount|cantidad)\b/g],
  ['saldo', /\b(saldo|balance)\b(?!\s+(inicial|final|anterior|de\s+apertura|de\s+cierre))/g],
];

/** Minúsculas y sin tildes, conservando la posición de cada carácter (para ubicar los títulos). */
function sinTildes(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Une dos líneas de cabecera (títulos partidos en dos renglones): cada celda de abajo va con la de arriba que solapa. */
function unirLineas(arriba: Linea, abajo: Linea): Celda[] {
  const celdas = arriba.celdas.map((c) => ({ ...c }));
  for (const c of abajo.celdas) {
    const encima = celdas.find((x) => c.x0 < x.x1 + 2 && c.x1 > x.x0 - 2);
    if (encima) {
      encima.texto = `${encima.texto} ${c.texto}`;
      encima.x0 = Math.min(encima.x0, c.x0);
      encima.x1 = Math.max(encima.x1, c.x1);
    } else celdas.push({ ...c });
  }
  return celdas.sort((x, y) => x.x0 - y.x0);
}

function columnasDeCeldas(celdas: readonly Celda[]): Columna[] | null {
  const cols: Columna[] = [];
  for (const c of celdas) {
    const n = sinTildes(c.texto);
    if (!n.trim()) continue;
    const ancho = c.x1 - c.x0;
    for (const [rol, re] of TITULOS) {
      if (cols.some((x) => x.rol === rol)) continue;
      re.lastIndex = 0;
      const m = re.exec(n);
      if (!m) continue;
      // Posición aproximada del título dentro del fragmento, por la proporción de caracteres.
      const x0 = c.x0 + (ancho * m.index) / n.length;
      const x1 = c.x0 + (ancho * (m.index + m[0].length)) / n.length;
      cols.push({ rol, x0, x1 });
    }
  }
  const tiene = (r: Rol) => cols.some((c) => c.rol === r);
  const importes = tiene('importe') || (tiene('cargo') && tiene('abono'));
  return tiene('fecha') && tiene('concepto') && importes ? cols.sort((x, y) => x.x0 - y.x0) : null;
}

function columnasDeCabecera(l: Linea, siguiente: Linea | undefined): { cols: Columna[]; lineas: number } | null {
  if (l.texto.length > 160) return null;
  const una = columnasDeCeldas(l.celdas);
  if (una) return { cols: una, lineas: 1 };
  if (siguiente && siguiente.pagina === l.pagina && l.y - siguiente.y <= Math.max(l.alto, siguiente.alto) * 1.6) {
    const dos = columnasDeCeldas(unirLineas(l, siguiente));
    if (dos) return { cols: dos, lineas: 2 };
  }
  return null;
}

/** Separa "2 ene 2026 Mercadona" en la fecha y el resto (cuando el PDF los da juntos). */
function separarFecha(texto: string): { fecha: string; resto: string } | null {
  const palabras = texto.trim().split(/\s+/);
  for (let k = 1; k <= Math.min(6, palabras.length); k++) {
    const fecha = palabras.slice(0, k).join(' ');
    if (parsearFecha(fecha) !== null) return { fecha, resto: palabras.slice(k).join(' ') };
  }
  return null;
}

// --- Importes y asignación a columnas --------------------------------------------------------

const RE_IMPORTE = /^[-+\u2212(]?\s*(?:[€$£]|EUR|USD|GBP)?\s*[-\u2212]?\s*(?:\d{1,3}(?:[.,\s\u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:[€$£]|EUR|USD|GBP)?\s*[-)]?$/i;

function esImporte(t: string): boolean {
  return RE_IMPORTE.test(t.trim()) && /\d/.test(t);
}

function divisaDe(t: string): string | null {
  if (/\$|USD/i.test(t)) return 'USD';
  if (/£|GBP/i.test(t)) return 'GBP';
  return null;
}

const IMPORTES: readonly Rol[] = ['cargo', 'abono', 'importe', 'saldo'];

function asignar(c: Celda, cols: readonly Columna[]): Rol | null {
  const centro = (a: { x0: number; x1: number }) => (a.x0 + a.x1) / 2;
  if (esImporte(c.texto)) {
    // Los importes suelen ir alineados a la derecha de su título; se toma la referencia más cercana.
    let mejor: Columna | null = null;
    let dist = Infinity;
    for (const col of cols) {
      if (!IMPORTES.includes(col.rol)) continue;
      const d = Math.min(Math.abs(c.x1 - col.x1), Math.abs(centro(c) - centro(col)), Math.abs(c.x0 - col.x0));
      if (d < dist) {
        dist = d;
        mejor = col;
      }
    }
    return mejor?.rol ?? null;
  }
  const colFecha = cols.find((col) => col.rol === 'fecha');
  const colConcepto = cols.find((col) => col.rol === 'concepto');
  // Una fecha solo cuenta como fecha del movimiento si está en su columna (un concepto puede empezar por una fecha).
  if (parsearFecha(c.texto) !== null && colFecha && (!colConcepto || Math.abs(c.x0 - colFecha.x0) <= Math.abs(c.x0 - colConcepto.x0))) return 'fecha';
  // Texto: la columna de texto que empieza más cerca por la izquierda.
  const textuales = cols.filter((col) => col.rol === 'concepto' || col.rol === 'fecha');
  let mejor: Columna | null = null;
  for (const col of textuales) if (!mejor || Math.abs(c.x0 - col.x0) < Math.abs(c.x0 - mejor.x0)) mejor = col;
  return mejor?.rol === 'fecha' ? 'concepto' : (mejor?.rol ?? null);
}

// --- Secciones -------------------------------------------------------------------------------

interface Seccion {
  estado: 'completado' | 'pendiente' | 'revertido';
  ahorro: boolean;
  /** Divisa de la sección si su título la indica (p. ej. "Extracto en USD"). */
  divisa: string | null;
}

/** Los títulos de sección cambian cómo se tratan las filas que vienen después. */
function seccionDeTitulo(texto: string, actual: Seccion): Seccion {
  const n = normalizarTexto(texto);
  // Solo los títulos (líneas cortas): los pies de página largos mencionan "depósitos" o "pendientes" sin serlo.
  if (n.length > 90) return actual;
  let s = actual;
  if (/\b(pendientes?|pending)\b/.test(n)) s = { ...s, estado: 'pendiente' };
  else if (/\b(revertidas?|reverted|anuladas?|canceladas?|cancelled)\b/.test(n)) s = { ...s, estado: 'revertido' };
  else if (/\b(transacciones|transactions|movimientos|operaciones)\b/.test(n)) s = { ...s, estado: 'completado' };
  if (/\b(hucha|huchas|pocket|pockets|savings|vault|cuenta de ahorro|cuenta remunerada)\b/.test(n)) s = { ...s, ahorro: true };
  else if (/\b(cuenta corriente|current account|account transactions|transacciones de la cuenta|cuenta principal)\b/.test(n)) s = { ...s, ahorro: false };
  const divisa = /\b(eur|usd|gbp|chf|pln|czk|huf|ron|sek|nok|dkk|jpy|aud|cad|try|mxn)\b/.exec(n)?.[1];
  if (divisa && /\b(extracto|statement|cuenta|account|transacciones|transactions|saldo|balance)\b/.test(n)) s = { ...s, divisa: divisa.toUpperCase() };
  return s;
}

// --- Tipo de operación deducido del concepto (el PDF no trae la columna "Type" del CSV) ------

export function tipoPorConcepto(concepto: string, importe: Centimos): string | null {
  const n = normalizarTexto(concepto);
  if (/^(apple pay |google pay )?(recarga|top-?up)\b|^recarga (de|con|mediante)\b/.test(n)) return 'TOPUP';
  if (/^(retirada de efectivo|retirada en cajero|cash withdrawal|cash at|efectivo en|atm)\b/.test(n)) return 'ATM';
  if (/^(cambiado a|cambio a|cambio de divisa|exchanged to|exchange to)\b/.test(n)) return 'EXCHANGE';
  if (/^(reembolso|devolucion|refund)\b/.test(n) && importe > 0) return 'CARD_REFUND';
  if (/^(cashback|recompensa|reward)\b/.test(n) && importe > 0) return 'CASHBACK';
  if (/^(intereses|interest)\b/.test(n) && importe > 0) return 'INTEREST';
  if (/^(comision|cuota del plan|tarifa del plan)\b|\bplan fee\b|^fee\b/.test(n) && importe < 0) return 'FEE';
  if (/^(to|para|transfer to|transferencia a|enviado a)\s/.test(n)) return 'TRANSFER';
  if (/^(from|payment from|transfer from|transferencia de|recibido de|de parte de)\s/.test(n) && importe > 0) return 'TRANSFER';
  return null;
}

// --- Resumen ---------------------------------------------------------------------------------

type CampoResumen = Exclude<keyof ResumenPdf, 'etiqueta'>;

function leerResumen(lineas: readonly Linea[]): ResumenPdf[] {
  const out: ResumenPdf[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l) continue;
    const n = normalizarTexto(l.texto);
    if (!/(saldo inicial|opening balance)/.test(n) || !/(saldo final|closing balance)/.test(n)) continue;
    const titulos: { rol: CampoResumen; x: number }[] = [];
    for (const c of l.celdas) {
      const t = normalizarTexto(c.texto);
      const x = (c.x0 + c.x1) / 2;
      if (/saldo inicial|opening balance/.test(t)) titulos.push({ rol: 'inicial', x });
      else if (/dinero saliente|money out|salidas/.test(t)) titulos.push({ rol: 'salidas', x });
      else if (/dinero entrante|money in|entradas/.test(t)) titulos.push({ rol: 'entradas', x });
      else if (/saldo final|closing balance/.test(t)) titulos.push({ rol: 'final', x });
    }
    if (titulos.length < 4) continue;
    for (const fila of lineas.slice(i + 1, i + 8)) {
      if (fila.pagina !== l.pagina) break;
      const importes = fila.celdas.filter((c) => esImporte(c.texto));
      if (importes.length < 4) continue;
      const decimal = deducirDecimal(importes.map((c) => c.texto));
      const etiqueta = fila.celdas.filter((c) => !esImporte(c.texto)).map((c) => c.texto).join(' ');
      const r: Partial<Record<CampoResumen, Centimos>> = {};
      for (const c of importes) {
        const x = (c.x0 + c.x1) / 2;
        const t = titulos.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
        const v = parsearImporteBanco(c.texto, decimal);
        if (v !== null && r[t.rol] === undefined) r[t.rol] = t.rol === 'salidas' ? Math.abs(v) : v;
      }
      if (r.inicial !== undefined && r.salidas !== undefined && r.entradas !== undefined && r.final !== undefined && r.inicial - r.salidas + r.entradas === r.final) {
        out.push({ etiqueta, inicial: r.inicial, salidas: r.salidas, entradas: r.entradas, final: r.final });
      }
    }
  }
  return out;
}

// --- Columnas por contenido (cuando el PDF no tiene títulos reconocibles) --------------------

function mediana(v: readonly number[]): number {
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)] ?? 0;
}

interface FilaConFecha {
  l: Linea;
  primera: Celda;
  importes: Celda[];
}

function filasConFecha(lineas: readonly Linea[]): FilaConFecha[] {
  return lineas.flatMap((l) => {
    const primera = l.celdas[0];
    if (!primera || !separarFecha(primera.texto)) return [];
    const importes = l.celdas.filter((c) => esImporte(c.texto));
    return importes.length > 0 ? [{ l, primera, importes }] : [];
  });
}

/**
 * Propone columnas mirando las filas que empiezan por una fecha: los importes se agrupan por su borde
 * derecho (van alineados) y la columna más a la derecha que aparece en casi todas las filas es el saldo.
 * Devuelve varias propuestas (qué columna es el cargo y cuál el abono); se queda la que cuadre.
 */
function inferirColumnas(lineas: readonly Linea[]): Columna[][] {
  const filas = filasConFecha(lineas);
  if (filas.length < 2) return [];
  const fechaX0 = mediana(filas.map((f) => f.primera.x0));
  const conceptoX0 = mediana(
    filas.map((f) => {
      const sf = separarFecha(f.primera.texto);
      if (sf?.resto) return f.primera.x0 + ((f.primera.x1 - f.primera.x0) * (sf.fecha.length + 1)) / f.primera.texto.length;
      const siguiente = f.l.celdas[1];
      return siguiente && !esImporte(siguiente.texto) ? siguiente.x0 : f.primera.x1 + 10;
    }),
  );
  // Solo importes claramente a la derecha del concepto (un número suelto dentro del concepto no es una columna).
  const bordes = filas.flatMap((f) => f.importes.filter((c) => c.x0 > conceptoX0 + 20).map((c) => ({ x0: c.x0, x1: c.x1 }))).sort((a, b) => a.x1 - b.x1);
  const grupos: { x0: number; x1s: number[] }[] = [];
  for (const b of bordes) {
    const g = grupos[grupos.length - 1];
    const ultimo = g?.x1s[g.x1s.length - 1];
    if (g && ultimo !== undefined && b.x1 - ultimo <= 8) {
      g.x1s.push(b.x1);
      g.x0 = Math.min(g.x0, b.x0);
    } else grupos.push({ x0: b.x0, x1s: [b.x1] });
  }
  const columnas = grupos
    .map((g) => ({ x0: g.x0, x1: mediana(g.x1s), n: g.x1s.length }));
  if (columnas.length === 0 || columnas.length > 4) return [];
  const ultima = columnas[columnas.length - 1];
  const saldo = ultima && columnas.length > 1 && ultima.n >= filas.length * 0.6 ? ultima : null;
  const resto = saldo ? columnas.slice(0, -1) : columnas;
  const base: Columna[] = [
    { rol: 'fecha', x0: fechaX0, x1: fechaX0 + 1 },
    { rol: 'concepto', x0: conceptoX0, x1: conceptoX0 + 1 },
    ...(saldo ? [{ rol: 'saldo' as const, x0: saldo.x0, x1: saldo.x1 }] : []),
  ];
  const col = (rol: Rol, c: { x0: number; x1: number }): Columna => ({ rol, x0: c.x0, x1: c.x1 });
  const [a, b] = resto;
  if (resto.length === 1 && a) return [[...base, col('importe', a)]];
  if (resto.length === 2 && a && b) return [[...base, col('cargo', a), col('abono', b)], [...base, col('cargo', b), col('abono', a)]];
  return [];
}

// --- Tabla de movimientos --------------------------------------------------------------------

const CABECERA = ['Fecha', 'Concepto', 'Cargo', 'Abono', 'Importe', 'Saldo', 'Estado', 'Divisa'];

interface Tabla {
  filas: string[][];
  ahorro: Descartado[];
  cabeceras: number;
  cols: Columna[] | null;
}

function extraerTabla(lineas: readonly Linea[], inferidas: Columna[] | null): Tabla {
  const filas: string[][] = [CABECERA];
  const ahorro: Descartado[] = [];
  let cols: Columna[] | null = inferidas;
  let activa = false;
  let seccion: Seccion = { estado: 'completado', ahorro: false, divisa: null };
  let anterior: Linea | null = null;
  let filaActual: string[] | null = null;
  let cabeceras = 0;

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l) continue;
    const cabecera = columnasDeCabecera(l, lineas[i + 1]);
    if (cabecera) {
      cols = cabecera.cols;
      activa = true;
      cabeceras++;
      i += cabecera.lineas - 1;
      anterior = lineas[i] ?? l;
      continue;
    }
    if (!cols) {
      seccion = seccionDeTitulo(l.texto, seccion);
      continue;
    }
    const actuales = cols;
    const asignadas = l.celdas.map((c) => ({ c, rol: asignar(c, actuales) }));
    const fecha = asignadas.find((a) => a.rol === 'fecha' && parsearFecha(a.c.texto) !== null);
    const importes = asignadas.filter((a) => a.rol !== null && IMPORTES.includes(a.rol));

    if (fecha && importes.some((a) => a.rol !== 'saldo')) {
      activa = true;
      const valor = (rol: Rol) => asignadas.filter((a) => a.rol === rol).map((a) => a.c.texto).join(' ');
      const sf = separarFecha(fecha.c.texto);
      const concepto = [sf?.resto ?? '', valor('concepto')].filter(Boolean).join(' ');
      const textoImportes = importes.map((a) => a.c.texto).join(' ');
      filaActual = [
        sf?.fecha ?? fecha.c.texto,
        concepto,
        valor('cargo'),
        valor('abono'),
        valor('importe'),
        valor('saldo'),
        seccion.estado,
        divisaDe(textoImportes) ?? seccion.divisa ?? 'EUR',
      ];
      if (seccion.ahorro) {
        ahorro.push({ fila: filas.length + ahorro.length + 1, motivo: 'Movimiento dentro de una hucha: ya aparece en la cuenta principal' });
        filaActual = null;
      } else filas.push(filaActual);
      anterior = l;
      continue;
    }

    // Segunda línea del concepto (referencia, tarjeta, tipo de cambio): justo debajo y sin importes.
    const cerca = anterior !== null && anterior.pagina === l.pagina && anterior.y - l.y <= Math.max(anterior.alto, l.alto) * 2.4;
    const enConcepto = asignadas.every((a) => a.rol === 'concepto');
    if (activa && filaActual && cerca && enConcepto && importes.length === 0) {
      filaActual[1] = `${filaActual[1] ?? ''} ${l.texto}`.trim();
      anterior = l;
      continue;
    }

    // Cualquier otra cosa termina la tabla: pie de página, totales o el título de otra sección.
    activa = false;
    filaActual = null;
    anterior = l;
    seccion = seccionDeTitulo(l.texto, seccion);
  }
  return { filas, ahorro, cabeceras, cols };
}

function lecturaDeTabla(t: Tabla, lineas: readonly Linea[], resumenes: readonly ResumenPdf[]): { lectura: LecturaExtracto; control: ControlResumen | null } | null {
  const datos = t.filas.slice(1);
  if (!t.cols || datos.length === 0) return null;
  const inicio = lineas.slice(0, 40).map((l) => l.texto).join(' ');
  const esRevolut = /revolut/i.test(inicio);
  const usa = (i: number) => datos.some((r) => (r[i] ?? '') !== '');
  const conImporte = usa(4);
  const mapeo: Mapeo = {
    formato: esRevolut ? 'revolut' : 'generico',
    filaCabecera: 0,
    fecha: 0,
    concepto: 1,
    importe: conImporte ? 4 : null,
    cargo: conImporte ? null : 2,
    abono: conImporte ? null : 3,
    saldo: usa(5) ? 5 : null,
    divisa: 7,
    tipo: null,
    producto: null,
    estado: 6,
    comision: null,
    decimal: deducirDecimal(datos.flatMap((r) => [r[2], r[3], r[4], r[5]]).filter((v): v is string => !!v)),
  };
  const base = extraerMovimientos(t.filas, mapeo, 'pdf');
  const lectura: LecturaExtracto = {
    ...base,
    movimientos: base.movimientos.map((m) => ({ ...m, tipoBanco: tipoPorConcepto(m.concepto, m.importe) })),
    banco: esRevolut ? 'Revolut' : /santander/i.test(inicio) ? 'Santander' : base.banco,
    formato: esRevolut ? 'revolut' : base.formato,
    descartados: [...base.descartados, ...t.ahorro],
  };
  // Comprobación contra el resumen del propio extracto: lo leído debe sumar lo mismo que dice el banco.
  let control: ControlResumen | null = null;
  if (resumenes.length > 0) {
    const entradas = lectura.movimientos.filter((m) => m.importe > 0).reduce((s, m) => s + m.importe, 0);
    const salidas = lectura.movimientos.filter((m) => m.importe < 0).reduce((s, m) => s - m.importe, 0);
    const neto = entradas - salidas;
    const coincide = resumenes.find((r) => r.entradas === entradas && r.salidas === salidas) ?? resumenes.find((r) => r.final - r.inicial === neto);
    control = { resumen: coincide ?? (resumenes[0] as ResumenPdf), entradas, salidas, ok: coincide !== undefined };
  }
  return { lectura, control };
}

// --- Varios productos en el mismo PDF ------------------------------------------------------

/**
 * Un extracto puede traer varias cuentas o productos, cada uno con su propia secuencia de saldos.
 * Se separan las filas en cadenas continuas (saldo anterior + importe = saldo) y se queda la cadena
 * que suma exactamente lo que dice el resumen para una cuenta que no es hucha ni ahorro.
 */
function porCadenas(r: NonNullable<ReturnType<typeof lecturaDeTabla>>, resumenes: readonly ResumenPdf[]): NonNullable<ReturnType<typeof lecturaDeTabla>> | null {
  const movs = r.lectura.movimientos;
  if (resumenes.length === 0 || movs.some((m) => m.saldo === null)) return null;
  const cadenas: (typeof movs)[] = [];
  let actual: typeof movs = [];
  for (const m of movs) {
    const prev = actual[actual.length - 1];
    const sigue = prev && prev.saldo !== null && m.saldo !== null && (prev.saldo + m.importe === m.saldo || m.saldo + prev.importe === prev.saldo);
    if (prev && !sigue) {
      cadenas.push(actual);
      actual = [];
    }
    actual.push(m);
  }
  if (actual.length) cadenas.push(actual);
  if (cadenas.length < 2) return null;
  const cuentas = resumenes.filter((x) => !/\b(hucha|pocket|ahorro|savings|vault|deposito|total)\b/i.test(normalizarTexto(x.etiqueta)));
  const suma = (c: typeof movs) => ({
    entradas: c.filter((m) => m.importe > 0).reduce((t, m) => t + m.importe, 0),
    salidas: c.filter((m) => m.importe < 0).reduce((t, m) => t - m.importe, 0),
  });
  const candidatas = cadenas.flatMap((c) => {
    const t = suma(c);
    const res = cuentas.find((x) => x.entradas === t.entradas && x.salidas === t.salidas);
    return res ? [{ c, t, res }] : [];
  });
  const [unica] = candidatas;
  if (candidatas.length !== 1 || !unica || cuadrar(unica.c).estado !== 'ok') return null;
  const fuera = movs.length - unica.c.length;
  return {
    lectura: {
      ...r.lectura,
      movimientos: unica.c,
      descartados: [...r.lectura.descartados, ...(fuera > 0 ? [{ fila: 0, motivo: `${fuera} movimientos de otras cuentas o productos del mismo PDF` }] : [])],
    },
    control: { resumen: unica.res, entradas: unica.t.entradas, salidas: unica.t.salidas, ok: true },
  };
}

// --- Diagnóstico sin datos -------------------------------------------------------------------

const VOCABULARIO = new Set(
  ('fecha date descripcion description concepto detalle dinero saliente entrante money out in paid saldo balance importe amount ' +
    'cargo abono transacciones transactions movimientos pendientes pending revertidas reverted cuenta corriente current account ' +
    'hucha huchas pocket pockets ahorro savings vault resumen summary total producto product inicial final opening closing pagina page ' +
    'de del la el los las en al a desde hasta from to eur usd gbp extracto statement revolut tarjeta card comision fee tipo cambio').split(' '),
);

/** Texto con las palabras que no son títulos convertidas en "aaa" y los números en "9". */
function mascara(texto: string): string {
  return texto
    .split(/\s+/)
    .map((w) => (VOCABULARIO.has(normalizarTexto(w).replace(/[^a-z]/g, '')) ? w : w.replace(/\p{L}/gu, 'a').replace(/\d/g, '9')))
    .join(' ')
    .slice(0, 160);
}

function formaDeFila(l: Linea): string {
  return l.celdas
    .map((c) => `${separarFecha(c.texto) && !esImporte(c.texto) ? 'fecha' : esImporte(c.texto) ? 'importe' : 'texto'}@${Math.round(c.x0)}-${Math.round(c.x1)}`)
    .join(' | ');
}

function diagnosticar(textos: readonly TextoPdf[], paginas: number, lineas: readonly Linea[], intentos: readonly { nombre: string; t: Tabla; r: ReturnType<typeof lecturaDeTabla> }[], resumenes: number): string {
  const titulares = lineas
    .filter((l) => TITULOS.filter(([, re]) => ((re.lastIndex = 0), re.test(normalizarTexto(l.texto)))).length >= 2 && l.texto.length <= 160)
    .slice(0, 6)
    .map((l) => `  p${l.pagina}: ${l.celdas.map((c) => `[${Math.round(c.x0)}-${Math.round(c.x1)}] ${mascara(c.texto)}`).join(' | ')}`);
  const filas = filasConFecha(lineas).slice(0, 4).map((f) => `  p${f.l.pagina}: ${formaDeFila(f.l)}`);
  return [
    `PDF: ${paginas} páginas · ${textos.length} fragmentos de texto · ${lineas.length} líneas`,
    `Resumen del saldo: ${resumenes > 0 ? 'encontrado' : 'no encontrado'} · Revolut: ${/revolut/i.test(lineas.slice(0, 40).map((l) => l.texto).join(' ')) ? 'sí' : 'no'}`,
    `Filas que empiezan por fecha: ${filasConFecha(lineas).length}`,
    ...intentos.map(({ nombre, t, r }) => {
      const c = r ? cuadrar(r.lectura.movimientos) : null;
      return `Intento ${nombre}: cabeceras ${t.cabeceras} · columnas ${(t.cols ?? []).map((x) => x.rol).join(',') || 'ninguna'} · filas ${t.filas.length - 1} · huchas ${t.ahorro.length} · saldos ${c ? `${c.estado} (${c.descuadres.length} fallos de ${c.comprobados})` : '—'} · resumen ${r?.control ? (r.control.ok ? 'coincide' : 'no coincide') : '—'}`;
    }),
    'Líneas con títulos (palabras ajenas ocultas):',
    ...(titulares.length ? titulares : ['  ninguna']),
    'Forma de las primeras filas con fecha:',
    ...(filas.length ? filas : ['  ninguna']),
  ].join('\n');
}

// --- Lectura completa ------------------------------------------------------------------------

export function leerPdfExtracto(textos: readonly TextoPdf[], paginas: number): LecturaPdf {
  const lineas = agruparLineas(textos);
  const resumenes = leerResumen(lineas);
  const intentos: { nombre: string; t: Tabla; r: ReturnType<typeof lecturaDeTabla> }[] = [];
  const probar = (nombre: string, inferidas: Columna[] | null) => {
    const t = extraerTabla(lineas, inferidas);
    const r = lecturaDeTabla(t, lineas, resumenes);
    intentos.push({ nombre, t, r });
    return r;
  };
  const verificada = (r: ReturnType<typeof lecturaDeTabla>) => r !== null && cuadrar(r.lectura.movimientos).estado === 'ok' && r.control?.ok !== false;

  // 1. Por los títulos de las columnas.
  const porTitulos = probar('títulos', null);
  let elegida = verificada(porTitulos) ? porTitulos : null;
  // 2. Si no hay títulos o lo leído no cuadra: columnas por la alineación de los importes.
  if (!elegida) {
    for (const [i, cols] of inferirColumnas(lineas).entries()) {
      const r = probar(`alineación ${i + 1}`, cols);
      if (verificada(r)) {
        elegida = r;
        break;
      }
    }
  }
  // 3. Varios productos mezclados: la cadena de saldos que coincide con la cuenta del resumen.
  if (!elegida) {
    for (const it of [...intentos]) {
      const r = it.r ? porCadenas(it.r, resumenes) : null;
      if (r) {
        intentos.push({ nombre: `${it.nombre} por cadenas de saldo`, t: it.t, r });
        elegida = r;
        break;
      }
    }
  }
  // Sin una lectura verificada se muestra la de los títulos (con su descuadre) para que se vea qué falla.
  const resultado = elegida ?? porTitulos;
  const diagnostico = diagnosticar(textos, paginas, lineas, intentos, resumenes.length);
  if (textos.length === 0 || !resultado) return { lectura: null, control: null, diagnostico };
  return { lectura: resultado.lectura, control: resultado.control, diagnostico };
}
