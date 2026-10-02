import { sumar, type Centimos } from './dinero';
import {
  compararPeriodos,
  idMes,
  sumarMeses,
  type Categoria,
  type Gasto,
  type Ingreso,
  type IngresoExtra,
  type MesRegistro,
  type Pagador,
  type Periodo,
  type Presupuesto,
  type Regla,
  type Traspaso,
  importeGasto,
} from './modelo';
import { repartirResultado, type ReglasReparto, type Reparto } from './reparto';

export interface DatosFinancieros {
  pagadores: Pagador[];
  categorias: Categoria[];
  ingresos: Ingreso[];
  extras: IngresoExtra[];
  gastos: Gasto[];
  meses: MesRegistro[];
  reglas: Regla[];
  traspasos: Traspaso[];
  presupuestos: Presupuesto[];
}

/**
 *  - vacio: no hay nada registrado ni se ha confirmado (hueco).
 *  - real: mes pasado o en curso con todos los ingresos en Real (o confirmado sin ingresos: mes a 0).
 *  - previsto: mes futuro o con algún ingreso aún en Previsto.
 */
export type EstadoMes = 'vacio' | 'real' | 'previsto';

export interface ResumenMes extends Periodo {
  estado: EstadoMes;
  ingresosNomina: Centimos;
  propinas: Centimos;
  otrosExtras: Centimos;
  ingresos: Centimos;
  gastosFijos: Centimos;
  gastosVariables: Centimos;
  gastosExtra: Centimos;
  gastos: Centimos;
  resultado: Centimos;
}

/** Índice por mes para no recorrer todas las tablas en cada consulta. */
export interface IndiceMeses {
  ingresos: Map<string, Ingreso[]>;
  extras: Map<string, IngresoExtra[]>;
  gastos: Map<string, Gasto[]>;
  confirmados: Set<string>;
}

function agrupar<T extends { anio: number; mes: number }>(filas: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const f of filas) {
    const k = idMes(f.anio, f.mes);
    const lista = m.get(k);
    if (lista) lista.push(f);
    else m.set(k, [f]);
  }
  return m;
}

export function indexar(d: DatosFinancieros): IndiceMeses {
  return {
    ingresos: agrupar(d.ingresos),
    extras: agrupar(d.extras),
    gastos: agrupar(d.gastos),
    confirmados: new Set(d.meses.filter((m) => m.confirmado).map((m) => m.id)),
  };
}

export function resumirMes(indice: IndiceMeses, p: Periodo, hoy: Periodo): ResumenMes {
  const k = idMes(p.anio, p.mes);
  const ingresos = indice.ingresos.get(k) ?? [];
  const extras = indice.extras.get(k) ?? [];
  const gastos = indice.gastos.get(k) ?? [];

  const ingresosNomina = sumar(ingresos.map((i) => i.neto));
  const propinas = sumar(extras.filter((e) => e.concepto === 'Propinas').map((e) => e.importe));
  const otrosExtras = sumar(extras.filter((e) => e.concepto !== 'Propinas').map((e) => e.importe));
  const porTipo = (t: Gasto['tipo']) => sumar(gastos.filter((g) => g.tipo === t).map(importeGasto));
  const gastosFijos = porTipo('Fijo');
  const gastosVariables = porTipo('Variable');
  const gastosExtra = porTipo('Extra');

  const tieneDatos = ingresos.length + extras.length + gastos.length > 0 || indice.confirmados.has(k);
  let estado: EstadoMes;
  if (!tieneDatos) estado = 'vacio';
  else if (compararPeriodos(p, hoy) > 0 || ingresos.some((i) => i.estado === 'Previsto')) estado = 'previsto';
  else estado = 'real';

  const totalIngresos = ingresosNomina + propinas + otrosExtras;
  const totalGastos = gastosFijos + gastosVariables + gastosExtra;
  return {
    anio: p.anio,
    mes: p.mes,
    estado,
    ingresosNomina,
    propinas,
    otrosExtras,
    ingresos: totalIngresos,
    gastosFijos,
    gastosVariables,
    gastosExtra,
    gastos: totalGastos,
    resultado: totalIngresos - totalGastos,
  };
}

export function serieMeses(indice: IndiceMeses, desde: Periodo, hasta: Periodo, hoy: Periodo): ResumenMes[] {
  const out: ResumenMes[] = [];
  for (let p = desde; compararPeriodos(p, hasta) <= 0; p = sumarMeses(p, 1)) {
    out.push(resumirMes(indice, p, hoy));
    if (out.length > 1200) break; // salvaguarda: 100 años
  }
  return out;
}

export interface TotalesAnio {
  ingresos: Centimos;
  gastos: Centimos;
  resultado: Centimos;
  mesesReales: number;
  mesesPrevistos: number;
  mesesVacios: number;
}

export function totalesAnio(meses: readonly ResumenMes[]): TotalesAnio {
  return {
    ingresos: sumar(meses.map((m) => m.ingresos)),
    gastos: sumar(meses.map((m) => m.gastos)),
    resultado: sumar(meses.map((m) => m.resultado)),
    mesesReales: meses.filter((m) => m.estado === 'real').length,
    mesesPrevistos: meses.filter((m) => m.estado === 'previsto').length,
    mesesVacios: meses.filter((m) => m.estado === 'vacio').length,
  };
}

/**
 * Gasto medio mensual de los meses reales con algún gasto.
 * Se excluyen los meses sin gastos para no infravalorar el colchón por meses a medio rellenar.
 */
export function gastoMedioMensual(meses: readonly ResumenMes[]): Centimos {
  const validos = meses.filter((m) => m.estado === 'real' && m.gastos > 0);
  if (validos.length === 0) return 0;
  return Math.round(sumar(validos.map((m) => m.gastos)) / validos.length);
}

export interface PasoColchon extends Periodo {
  estado: EstadoMes;
  resultado: Centimos;
  colchonInicio: Centimos;
  reparto: Reparto;
  colchonFin: Centimos;
  aviso: string | null;
  completaColchon: boolean;
}

export interface SimulacionColchon {
  pasos: PasoColchon[];
  colchon: Centimos;
  acumulado: Reparto;
}

/**
 * Recorre los meses en orden y aplica el reparto.
 * Con `incluirPrevistos` = false solo mueven el colchón los meses reales (lo que tienes de verdad).
 */
export function simularColchon(
  meses: readonly ResumenMes[],
  ahorroInicial: Centimos,
  objetivo: Centimos,
  reglas: ReglasReparto,
  incluirPrevistos: boolean,
): SimulacionColchon {
  let colchon = ahorroInicial;
  const acumulado: Reparto = { colchon: 0, inversion: 0, objetivos: 0, libre: 0 };
  const pasos: PasoColchon[] = [];
  for (const m of meses) {
    const cuenta = m.estado === 'real' || (incluirPrevistos && m.estado === 'previsto');
    if (!cuenta) continue;
    const r = repartirResultado(m.resultado, colchon, objetivo, reglas);
    const inicio = colchon;
    colchon += r.reparto.colchon;
    acumulado.colchon += r.reparto.colchon;
    acumulado.inversion += r.reparto.inversion;
    acumulado.objetivos += r.reparto.objetivos;
    acumulado.libre += r.reparto.libre;
    pasos.push({
      anio: m.anio,
      mes: m.mes,
      estado: m.estado,
      resultado: m.resultado,
      colchonInicio: inicio,
      reparto: r.reparto,
      colchonFin: colchon,
      aviso: r.aviso,
      completaColchon: r.completaColchon,
    });
  }
  return { pasos, colchon, acumulado };
}

export interface EstimacionColchon {
  objetivo: Centimos;
  acumulado: Centimos;
  falta: Centimos;
  /** 0..10000 */
  progreso: number;
  aportacionMedia: Centimos;
  fechaEstimada: Periodo | null;
  completo: boolean;
}

/**
 * Fecha estimada para completar el colchón con la aportación media de los últimos `ventana` meses reales.
 */
export function estimarColchon(
  sim: SimulacionColchon,
  objetivo: Centimos,
  ultimoMesReal: Periodo | null,
  ventana = 6,
): EstimacionColchon {
  const acumulado = sim.colchon;
  const falta = Math.max(0, objetivo - acumulado);
  const completo = objetivo > 0 && falta === 0;
  const ultimos = sim.pasos.filter((p) => p.estado === 'real').slice(-ventana);
  const aportacionMedia = ultimos.length > 0 ? Math.round(sumar(ultimos.map((p) => p.reparto.colchon)) / ultimos.length) : 0;
  let fechaEstimada: Periodo | null = null;
  if (completo && ultimoMesReal) fechaEstimada = ultimoMesReal;
  else if (falta > 0 && aportacionMedia > 0 && ultimoMesReal) {
    fechaEstimada = sumarMeses(ultimoMesReal, Math.ceil(falta / aportacionMedia));
  }
  const progreso = objetivo > 0 ? Math.min(10_000, Math.max(0, Math.floor((acumulado * 10_000) / objetivo))) : 0;
  return { objetivo, acumulado, falta, progreso, aportacionMedia, fechaEstimada, completo };
}
