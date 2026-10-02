import { sumar, type Centimos } from '../dinero';
import {
  idMes,
  type ArchivoImportado,
  type ConceptoExtra,
  type Evidencia,
  type Gasto,
  type Ingreso,
  type IngresoExtra,
  type Regla,
  type TipoGasto,
  type Traspaso,
} from '../modelo';
import { clasificar, UMBRAL_REVISION, type Destino, type Propuesta, type ReglaAprendida } from './clasificar';
import type { ResultadoCuadre } from './cuadre';
import type { LecturaExtracto } from './formatos';
import { sugerencia, type Modelo } from './aprendizaje';
import { claveSuelta, huellas } from './huella';

export interface ExtractoLeido {
  /** Nombre de la cuenta elegido por la persona (p. ej. "Santander"). */
  cuenta: string;
  lectura: LecturaExtracto;
  cuadre: ResultadoCuadre;
  /** Archivo de origen (huella y comprobaciones) para la evidencia de cada movimiento. */
  archivo?: ArchivoImportado;
}

export interface MovimientoPropuesto {
  /** Huella: identificador estable del movimiento. */
  id: string;
  cuenta: string;
  fecha: string;
  anio: number;
  mes: number;
  /** Con signo. */
  importe: Centimos;
  /** Solo en memoria durante la revisión; nunca se guarda. */
  concepto: string;
  propuesta: Propuesta;
  /** Ya importado antes (misma huella, o mismo día, importe y cuenta desde otro formato). */
  duplicado: boolean;
  /** Hay un movimiento igual ya importado el día anterior o el siguiente: se deja fuera salvo que digas lo contrario. */
  posibleDuplicado?: boolean;
  /** Huella del movimiento emparejado en otra cuenta. */
  pareja: string | null;
  /** Mismo comercio en varios meses con importe parecido. */
  recurrente: boolean;
  /** De qué archivo, página y fila sale. */
  evidencia?: Evidencia;
}

const DIAS_EMPAREJAR = 3;

function dias(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function periodo(fecha: string): { anio: number; mes: number } {
  return { anio: Number(fecha.slice(0, 4)), mes: Number(fecha.slice(5, 7)) };
}

/**
 * Empareja traspasos entre tus cuentas: un cargo en una y un abono del mismo importe en otra
 * con pocos días de diferencia. Solo se emparejan movimientos que pueden ser traspasos
 * (no compras con tarjeta), y cada movimiento con un único compañero, el más cercano en fecha.
 */
export function emparejarTraspasos(movs: MovimientoPropuesto[]): void {
  const puedeSalir = (m: MovimientoPropuesto) =>
    m.importe < 0 && (m.propuesta.destino === 'interno' || m.propuesta.limpio.persona === 'transferencia' || m.propuesta.motivo === 'Comercio desconocido');
  const puedeEntrar = (m: MovimientoPropuesto) => m.importe > 0 && (m.propuesta.destino === 'interno' || m.propuesta.destino === 'extra');

  const entradas = movs.filter((m) => !m.duplicado && puedeEntrar(m));
  const usadas = new Set<string>();
  for (const s of movs.filter((m) => !m.duplicado && puedeSalir(m))) {
    let mejor: MovimientoPropuesto | null = null;
    for (const e of entradas) {
      if (usadas.has(e.id) || e.cuenta === s.cuenta || e.importe !== -s.importe) continue;
      const d = dias(e.fecha, s.fecha);
      if (d > DIAS_EMPAREJAR) continue;
      if (!mejor || d < dias(mejor.fecha, s.fecha)) mejor = e;
    }
    if (!mejor) continue;
    usadas.add(mejor.id);
    for (const [m, otra] of [[s, mejor], [mejor, s]] as const) {
      m.pareja = otra.id;
      m.propuesta = { ...m.propuesta, destino: 'interno', categoria: null, categoriaId: null, confianza: 0.99, motivo: `Traspaso emparejado con ${otra.cuenta}` };
    }
  }
}

/** Marca como fijos los gastos que se repiten cada mes con importe parecido (±15 %). */
export function detectarRecurrentes(movs: MovimientoPropuesto[]): void {
  const grupos = new Map<string, MovimientoPropuesto[]>();
  for (const m of movs) {
    if (m.propuesta.destino !== 'gasto' || m.importe >= 0 || !m.propuesta.limpio.clave) continue;
    const lista = grupos.get(m.propuesta.limpio.clave) ?? [];
    lista.push(m);
    grupos.set(m.propuesta.limpio.clave, lista);
  }
  for (const lista of grupos.values()) {
    const meses = new Set(lista.map((m) => idMes(m.anio, m.mes)));
    if (meses.size < 2 || lista.length > meses.size * 2) continue;
    const importes = lista.map((m) => -m.importe).sort((a, b) => a - b);
    const mediana = importes[Math.floor(importes.length / 2)] ?? 0;
    if (mediana <= 0 || !importes.every((i) => Math.abs(i - mediana) <= mediana * 0.15)) continue;
    for (const m of lista) {
      m.recurrente = true;
      m.propuesta = { ...m.propuesta, tipoGasto: 'Fijo' };
    }
  }
}

/**
 * Prepara la revisión: huellas, clasificación, duplicados, traspasos y recurrentes.
 * Las comisiones de Revolut se separan en su propio movimiento.
 */
export async function prepararImportacion(
  extractos: readonly ExtractoLeido[],
  reglas: ReadonlyMap<string, ReglaAprendida>,
  existentes: ReadonlySet<string>,
  modelo: Modelo | null = null,
  /** Movimientos ya importados por cuenta, día e importe (claveSuelta → cuántos). */
  importados: ReadonlyMap<string, number> = new Map(),
): Promise<MovimientoPropuesto[]> {
  const out: MovimientoPropuesto[] = [];
  const enArchivos = new Map<string, number>();
  for (const ex of extractos) {
    const ordenados = ex.cuadre.ordenados;
    const ids = await huellas(ex.cuenta, ordenados);
    ordenados.forEach((m, i) => {
      const id = ids[i] ?? '';
      const { anio, mes } = periodo(m.fecha);
      // El n-ésimo movimiento igual (cuenta, día, importe) es duplicado si ya había al menos n importados.
      const ya = (importe: number) => {
        const clave = claveSuelta(ex.cuenta, m.fecha, importe);
        const n = enArchivos.get(clave) ?? 0;
        enArchivos.set(clave, n + 1);
        return n < (importados.get(clave) ?? 0);
      };
      // Con comisión aparte (CSV de Revolut) se busca también el total: el PDF puede mostrarlo sumado.
      const porImporte = ya(m.importe);
      const porTotal = m.comision > 0 && ya(m.importe - m.comision);
      const duplicado = existentes.has(id) || porImporte || porTotal;
      const evidencia: Evidencia | undefined = ex.archivo ? { archivo: ex.archivo.huella, fila: m.fila, ...(m.pagina ? { pagina: m.pagina } : {}) } : undefined;
      out.push({
        id, cuenta: ex.cuenta, fecha: m.fecha, anio, mes, importe: m.importe, concepto: m.concepto, propuesta: clasificar(m, reglas), duplicado, pareja: null, recurrente: false,
        ...(evidencia ? { evidencia } : {}),
      });
      if (m.comision > 0) {
        const idComision = `${id}-comision`;
        out.push({
          id: idComision, cuenta: ex.cuenta, fecha: m.fecha, anio, mes, importe: -m.comision, concepto: `Comisión ${ex.cuenta}`,
          propuesta: { destino: 'gasto', categoria: 'comisiones', categoriaId: null, tipoGasto: 'Variable', pagador: null, devolucion: false, confianza: 0.98, motivo: 'Comisión de la operación', limpio: { comercio: `Comisión ${ex.cuenta}`, clave: '', busqueda: '', persona: null } },
          duplicado: duplicado || existentes.has(idComision), pareja: null, recurrente: false,
          ...(evidencia ? { evidencia } : {}),
        });
      }
    });
  }
  marcarPosiblesDuplicados(out, importados, enArchivos);
  emparejarTraspasos(out);
  if (modelo) aplicarAprendizaje(out, modelo);
  detectarRecurrentes(out);
  return out.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

/** Fecha ISO desplazada n días. */
function moverDias(fecha: string, n: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Un banco puede fechar un pago con tarjeta el día de la compra en un formato y el de su cargo en otro.
 * Si queda un movimiento ya importado igual (cuenta e importe) el día anterior o el siguiente sin
 * corresponderse con nada de este archivo, se marca para que lo decidas tú.
 */
function marcarPosiblesDuplicados(movs: MovimientoPropuesto[], importados: ReadonlyMap<string, number>, enArchivos: ReadonlyMap<string, number>): void {
  if (importados.size === 0) return;
  for (const m of movs) {
    if (m.duplicado || m.id.endsWith('-comision')) continue;
    const sobra = [-1, 1].some((d) => {
      const k = claveSuelta(m.cuenta, moverDias(m.fecha, d), m.importe);
      return (importados.get(k) ?? 0) > (enArchivos.get(k) ?? 0);
    });
    if (sobra) m.posibleDuplicado = true;
  }
}

/**
 * Para los gastos que el diccionario no reconoce (o son genéricos), el aprendizaje local propone una
 * categoría. La propuesta se pre-rellena pero sigue en revisión: tú confirmas.
 */
export function aplicarAprendizaje(movs: MovimientoPropuesto[], modelo: Modelo): void {
  for (const m of movs) {
    const p = m.propuesta;
    if (m.duplicado || p.destino !== 'gasto' || p.confianza >= UMBRAL_REVISION || p.limpio.persona || !p.limpio.comercio) continue;
    const s = sugerencia(modelo, p.limpio.comercio);
    if (!s) continue;
    m.propuesta = { ...p, categoria: null, categoriaId: s.etiqueta, confianza: Math.min(p.confianza + 0.3, UMBRAL_REVISION - 0.01), motivo: `Sugerido por el aprendizaje local (${Math.round(s.probabilidad * 100)} %): confírmalo` };
  }
}

export function necesitaRevision(m: MovimientoPropuesto): boolean {
  return !m.duplicado && (m.propuesta.confianza < UMBRAL_REVISION || m.posibleDuplicado === true);
}

// --- Decisiones de la persona y filas resultantes -------------------------------------------

export interface Decision {
  incluir: boolean;
  destino: Destino;
  categoriaId: string | null;
  tipoGasto: TipoGasto;
  pagadorId: string | null;
  conceptoExtra: ConceptoExtra;
  /** Guardar una regla para este comercio. */
  recordar: boolean;
}

export interface FilasImportacion {
  gastos: Gasto[];
  ingresos: Ingreso[];
  extras: IngresoExtra[];
  traspasos: Traspaso[];
  reglas: Regla[];
  meses: Array<{ anio: number; mes: number }>;
}

export function validarDecision(m: MovimientoPropuesto, d: Decision): string | null {
  if (!d.incluir || m.duplicado) return null;
  if (d.destino === 'gasto' && !d.categoriaId) return 'Falta la categoría';
  if (d.destino === 'ingreso' && !d.pagadorId) return 'Falta el pagador';
  if ((d.destino === 'ingreso' || d.destino === 'extra') && m.importe < 0) return 'Una salida de dinero no puede ser un ingreso';
  return null;
}

export function construirFilas(movs: readonly MovimientoPropuesto[], decisiones: ReadonlyMap<string, Decision>, nuevoId: () => string): FilasImportacion {
  const r: FilasImportacion = { gastos: [], ingresos: [], extras: [], traspasos: [], reglas: [], meses: [] };
  const meses = new Map<string, { anio: number; mes: number }>();
  const reglas = new Map<string, Regla>();
  for (const m of movs) {
    const d = decisiones.get(m.id);
    if (!d || !d.incluir || m.duplicado) continue;
    const error = validarDecision(m, d);
    if (error) throw new Error(`${m.fecha} ${m.propuesta.limpio.comercio}: ${error}`);
    const comun = { anio: m.anio, mes: m.mes, fecha: m.fecha, cuenta: m.cuenta, huella: m.id, ...(m.evidencia ? { evidencia: m.evidencia } : {}) };
    meses.set(idMes(m.anio, m.mes), { anio: m.anio, mes: m.mes });
    const abs = Math.abs(m.importe);
    switch (d.destino) {
      case 'gasto':
        r.gastos.push({
          ...comun, id: nuevoId(), categoriaId: d.categoriaId ?? '', importe: abs, tipo: d.tipoGasto,
          nota: m.propuesta.limpio.comercio, comercio: m.propuesta.limpio.comercio,
          ...(m.importe > 0 ? { devolucion: true } : {}),
        });
        if (d.recordar && m.propuesta.limpio.clave && d.categoriaId) {
          reglas.set(m.propuesta.limpio.clave, { id: m.propuesta.limpio.clave, categoriaId: d.categoriaId, tipo: d.tipoGasto });
        }
        break;
      case 'ingreso':
        r.ingresos.push({
          ...comun, id: nuevoId(), pagadorId: d.pagadorId ?? '', bruto: abs, seguridadSocial: 0, retencionIRPF: 0, neto: abs,
          netoManual: false, estado: 'Real', nota: `Importado de ${m.cuenta}: completa bruto, SS y retención con la nómina`, pendienteNomina: true,
        });
        break;
      case 'extra':
        r.extras.push({ ...comun, id: nuevoId(), concepto: d.conceptoExtra, importe: abs, nota: m.propuesta.limpio.comercio });
        break;
      case 'interno':
      case 'hucha':
      case 'divisa':
        r.traspasos.push({
          id: m.id, anio: m.anio, mes: m.mes, fecha: m.fecha, cuenta: m.cuenta, importe: m.importe, tipo: d.destino,
          ...(m.pareja ? { pareja: m.pareja } : {}), ...(m.evidencia ? { evidencia: m.evidencia } : {}),
        });
        break;
    }
  }
  r.reglas = [...reglas.values()];
  r.meses = [...meses.values()];
  return r;
}

// --- Informe ---------------------------------------------------------------------------------

export interface InformeMes {
  anio: number;
  mes: number;
  ingresos: Centimos;
  gastos: Centimos;
  ahorro: Centimos;
  aHuchas: Centimos;
  traspasosInternos: Centimos;
}

export interface InformeImportacion {
  meses: InformeMes[];
  ingresos: Centimos;
  gastos: Centimos;
  ahorro: Centimos;
  porCategoria: Array<{ categoriaId: string; total: Centimos; movimientos: number }>;
  recurrentes: Array<{ comercio: string; importeMensual: Centimos; categoriaId: string }>;
  inusuales: Array<{ fecha: string; comercio: string; importe: Centimos; categoriaId: string; mediana: Centimos }>;
  /** Mediana mensual por categoría: base del presupuesto sugerido. */
  presupuestoSugerido: Array<{ categoriaId: string; importe: Centimos }>;
}

function mediana(v: readonly number[]): number {
  if (v.length === 0) return 0;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? (o[m] ?? 0) : Math.round(((o[m - 1] ?? 0) + (o[m] ?? 0)) / 2);
}

export function informe(filas: FilasImportacion): InformeImportacion {
  const claveMes = (a: number, m: number) => idMes(a, m);
  const meses = new Map<string, InformeMes>();
  const mesDe = (a: number, m: number) => {
    const k = claveMes(a, m);
    let x = meses.get(k);
    if (!x) {
      x = { anio: a, mes: m, ingresos: 0, gastos: 0, ahorro: 0, aHuchas: 0, traspasosInternos: 0 };
      meses.set(k, x);
    }
    return x;
  };
  const neto = (g: Gasto) => (g.devolucion ? -g.importe : g.importe);
  for (const i of filas.ingresos) mesDe(i.anio, i.mes).ingresos += i.neto;
  for (const e of filas.extras) mesDe(e.anio, e.mes).ingresos += e.importe;
  for (const g of filas.gastos) mesDe(g.anio, g.mes).gastos += neto(g);
  for (const t of filas.traspasos) {
    if (t.tipo === 'hucha') mesDe(t.anio, t.mes).aHuchas -= t.importe;
    if (t.tipo === 'interno' && t.importe < 0) mesDe(t.anio, t.mes).traspasosInternos -= t.importe;
  }
  const lista = [...meses.values()].sort((a, b) => a.anio * 12 + a.mes - (b.anio * 12 + b.mes));
  for (const m of lista) m.ahorro = m.ingresos - m.gastos;

  const porCat = new Map<string, { total: number; movimientos: number; porMes: Map<string, number>; importes: number[] }>();
  for (const g of filas.gastos) {
    const c = porCat.get(g.categoriaId) ?? { total: 0, movimientos: 0, porMes: new Map<string, number>(), importes: [] };
    c.total += neto(g);
    c.movimientos++;
    const k = claveMes(g.anio, g.mes);
    c.porMes.set(k, (c.porMes.get(k) ?? 0) + neto(g));
    if (!g.devolucion) c.importes.push(g.importe);
    porCat.set(g.categoriaId, c);
  }

  // Inusual: más del triple de la mediana de su categoría y más de 30 €.
  const inusuales: InformeImportacion['inusuales'] = [];
  for (const g of filas.gastos) {
    if (g.devolucion) continue;
    const c = porCat.get(g.categoriaId);
    if (!c || c.importes.length < 4) continue;
    const med = mediana(c.importes);
    if (g.importe > med * 3 && g.importe > 3000) inusuales.push({ fecha: g.fecha ?? '', comercio: g.comercio ?? g.nota, importe: g.importe, categoriaId: g.categoriaId, mediana: med });
  }

  const recurrentes = new Map<string, { comercio: string; importes: number[]; categoriaId: string }>();
  for (const g of filas.gastos) {
    if (g.tipo !== 'Fijo' || !g.comercio) continue;
    const r = recurrentes.get(g.comercio) ?? { comercio: g.comercio, importes: [], categoriaId: g.categoriaId };
    r.importes.push(g.importe);
    recurrentes.set(g.comercio, r);
  }

  return {
    meses: lista,
    ingresos: sumar(lista.map((m) => m.ingresos)),
    gastos: sumar(lista.map((m) => m.gastos)),
    ahorro: sumar(lista.map((m) => m.ahorro)),
    porCategoria: [...porCat.entries()].map(([categoriaId, c]) => ({ categoriaId, total: c.total, movimientos: c.movimientos })).sort((a, b) => b.total - a.total),
    recurrentes: [...recurrentes.values()].filter((r) => r.importes.length >= 2).map((r) => ({ comercio: r.comercio, importeMensual: mediana(r.importes), categoriaId: r.categoriaId })),
    inusuales,
    // Solo cuentan los meses con gastos (un mes en el que solo entró la nómina no es "un mes sin gastar").
    // Dentro de ellos, un mes sin gasto en una categoría cuenta como 0 para no inflar el presupuesto.
    presupuestoSugerido: [...porCat.entries()]
      .map(([categoriaId, c]) => {
        const valores = lista.filter((m) => m.gastos > 0).map((m) => Math.max(0, c.porMes.get(claveMes(m.anio, m.mes)) ?? 0));
        return { categoriaId, importe: Math.round(mediana(valores) / 100) * 100 };
      })
      .filter((p) => p.importe > 0),
  };
}
