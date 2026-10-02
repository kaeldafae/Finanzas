import type { Centimos } from '../dinero';
import { extraerMovimientos, type Descartado, type LecturaExtracto, type Mapeo } from './formatos';
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

const TITULOS: readonly [Rol, RegExp][] = [
  ['fecha', /^(fecha|date|data|f\. ?operacion|fecha operacion|fecha de operacion|completed date)$/],
  ['concepto', /^(descripcion|description|concepto|detalle|movimiento|descripcio|details)$/],
  ['cargo', /^(dinero saliente|money out|paid out|cargo|cargos|debe|debito|retirada|withdrawals?|salida)$/],
  ['abono', /^(dinero entrante|money in|paid in|abono|abonos|haber|credito|ingreso|deposits?|entrada)$/],
  ['importe', /^(importe|amount|cantidad|import)( eur| \(eur\))?$/],
  ['saldo', /^(saldo|balance|saldo eur|saldo disponible)$/],
];

function rolDeTitulo(texto: string): Rol | null {
  const n = normalizarTexto(texto).replace(/[:€]/g, '').trim();
  for (const [rol, re] of TITULOS) if (re.test(n)) return rol;
  return null;
}

function columnasDeCabecera(l: Linea): Columna[] | null {
  const cols: Columna[] = [];
  for (const c of l.celdas) {
    const rol = rolDeTitulo(c.texto);
    if (rol && !cols.some((x) => x.rol === rol)) cols.push({ rol, x0: c.x0, x1: c.x1 });
  }
  const tiene = (r: Rol) => cols.some((c) => c.rol === r);
  const importes = tiene('importe') || (tiene('cargo') && tiene('abono'));
  return tiene('fecha') && tiene('concepto') && importes ? cols : null;
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

function leerResumen(lineas: readonly Linea[]): ResumenPdf[] {
  const out: ResumenPdf[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l) continue;
    const n = normalizarTexto(l.texto);
    if (!/(saldo inicial|opening balance)/.test(n) || !/(saldo final|closing balance)/.test(n)) continue;
    const titulos: { rol: keyof ResumenPdf; x: number }[] = [];
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
      const r: Partial<ResumenPdf> = {};
      for (const c of importes) {
        const x = (c.x0 + c.x1) / 2;
        const t = titulos.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
        const v = parsearImporteBanco(c.texto, decimal);
        if (v !== null && r[t.rol] === undefined) r[t.rol] = t.rol === 'salidas' ? Math.abs(v) : v;
      }
      if (r.inicial !== undefined && r.salidas !== undefined && r.entradas !== undefined && r.final !== undefined && r.inicial - r.salidas + r.entradas === r.final) {
        out.push(r as ResumenPdf);
      }
    }
  }
  return out;
}

// --- Lectura completa ------------------------------------------------------------------------

const CABECERA = ['Fecha', 'Concepto', 'Cargo', 'Abono', 'Importe', 'Saldo', 'Estado', 'Divisa'];

export function leerPdfExtracto(textos: readonly TextoPdf[], paginas: number): LecturaPdf {
  const lineas = agruparLineas(textos);
  const tabla: string[][] = [CABECERA];
  const descartadosAhorro: Descartado[] = [];
  let cols: Columna[] | null = null;
  let activa = false;
  let seccion: Seccion = { estado: 'completado', ahorro: false };
  let anterior: Linea | null = null;
  let filaActual: string[] | null = null;
  let cabecerasVistas = 0;
  const esRevolut = /revolut/i.test(lineas.slice(0, 40).map((l) => l.texto).join(' '));

  for (const l of lineas) {
    const nuevas = columnasDeCabecera(l);
    if (nuevas) {
      cols = nuevas;
      activa = true;
      anterior = l;
      cabecerasVistas++;
      continue;
    }
    if (!cols) {
      seccion = seccionDeTitulo(l.texto, seccion);
      continue;
    }
    const asignadas = l.celdas.map((c) => ({ c, rol: asignar(c, cols ?? []) }));
    const fecha = asignadas.find((a) => a.rol === 'fecha' && parsearFecha(a.c.texto) !== null);
    const importes = asignadas.filter((a) => a.rol !== null && IMPORTES.includes(a.rol));

    if (fecha && importes.some((a) => a.rol !== 'saldo')) {
      activa = true;
      const valor = (rol: Rol) => asignadas.filter((a) => a.rol === rol).map((a) => a.c.texto).join(' ');
      const concepto = valor('concepto');
      const textoImportes = importes.map((a) => a.c.texto).join(' ');
      filaActual = [
        fecha.c.texto,
        concepto,
        valor('cargo'),
        valor('abono'),
        valor('importe'),
        valor('saldo'),
        seccion.estado,
        divisaDe(textoImportes) ?? 'EUR',
      ];
      if (seccion.ahorro) {
        descartadosAhorro.push({ fila: tabla.length + descartadosAhorro.length + 1, motivo: 'Movimiento dentro de una hucha: ya aparece en la cuenta principal' });
        filaActual = null;
      } else tabla.push(filaActual);
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

  const filas = tabla;
  const datos = filas.slice(1);
  const usa = (i: number) => datos.some((r) => (r[i] ?? '') !== '');
  const conImporte = usa(4);
  const valoresImporte = datos.flatMap((r) => [r[2], r[3], r[4], r[5]]).filter((v): v is string => !!v);
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
    decimal: deducirDecimal(valoresImporte),
  };

  const resumenes = leerResumen(lineas);
  const diagnostico = [
    `PDF: ${paginas} páginas · ${textos.length} fragmentos de texto · ${lineas.length} líneas`,
    `Cabecera de movimientos: ${cabecerasVistas > 0 ? `encontrada ${cabecerasVistas} veces (${(cols ?? []).map((c) => c.rol).join(', ')})` : 'no encontrada'}`,
    `Filas de movimientos: ${datos.length} · en huchas: ${descartadosAhorro.length}`,
    `Resumen del saldo: ${resumenes.length > 0 ? 'encontrado' : 'no encontrado'}`,
    `Decimal: "${mapeo.decimal}" · Revolut: ${esRevolut ? 'sí' : 'no'}`,
  ].join('\n');

  if (textos.length === 0) return { lectura: null, control: null, diagnostico };
  if (!cols || datos.length === 0) return { lectura: null, control: null, diagnostico };

  const base = extraerMovimientos(filas, mapeo, 'pdf');
  const lectura: LecturaExtracto = {
    ...base,
    movimientos: base.movimientos.map((m) => ({ ...m, tipoBanco: tipoPorConcepto(m.concepto, m.importe) })),
    banco: esRevolut ? 'Revolut' : /santander/i.test(lineas.slice(0, 40).map((l) => l.texto).join(' ')) ? 'Santander' : base.banco,
    formato: esRevolut ? 'revolut' : base.formato,
    descartados: [...base.descartados, ...descartadosAhorro],
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
  return { lectura, control, diagnostico };
}
