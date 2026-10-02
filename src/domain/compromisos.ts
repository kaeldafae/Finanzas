import type { Centimos } from './dinero';
import { compararPeriodos, idMes, importeGasto, sumarMeses, type Compromiso, type Gasto, type Periodicidad, type Periodo } from './modelo';

/**
 * Pagos recurrentes (alquiler, recibos, suscripciones, cuotas). Se detectan en los gastos ya guardados:
 * el mismo comercio (o el mismo gasto fijo apuntado a mano) con un importe estable cada mes,
 * trimestre o año. Lo detectado es una sugerencia: solo cuenta en la previsión si lo aceptas.
 */

export interface SugerenciaCompromiso {
  clave: string;
  nombre: string;
  categoriaId: string;
  importe: Centimos;
  periodicidad: Periodicidad;
  ultimoAnio: number;
  ultimoMes: number;
  /** Cuántas veces se ha repetido. */
  veces: number;
}

const PASOS: Record<Periodicidad, number> = { mensual: 1, trimestral: 3, anual: 12 };
const TOLERANCIA = 0.15;

function indiceMes(p: Periodo): number {
  return p.anio * 12 + (p.mes - 1);
}

export function normalizarClave(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function claveGasto(g: Gasto): string | null {
  if (g.devolucion) return null;
  if (g.comercio) return `c:${normalizarClave(g.comercio)}`;
  // Apuntado a mano: solo los fijos con nota (p. ej. "Alquiler piso").
  if (g.tipo === 'Fijo' && g.nota.trim()) return `m:${g.categoriaId}|${normalizarClave(g.nota)}`;
  return null;
}

function mediana(v: readonly number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const n = o.length;
  if (n === 0) return 0;
  const m = Math.floor(n / 2);
  return n % 2 ? (o[m] ?? 0) : Math.round(((o[m - 1] ?? 0) + (o[m] ?? 0)) / 2);
}

export function detectarCompromisos(gastos: readonly Gasto[], existentes: readonly Compromiso[], hoy: Periodo): SugerenciaCompromiso[] {
  const grupos = new Map<string, Gasto[]>();
  for (const g of gastos) {
    const k = claveGasto(g);
    if (!k) continue;
    const lista = grupos.get(k);
    if (lista) lista.push(g);
    else grupos.set(k, [g]);
  }
  const yaGuardados = new Set(existentes.filter((c) => !c.borrado).map((c) => normalizarClave(c.nombre)));
  const out: SugerenciaCompromiso[] = [];

  for (const [clave, lista] of grupos) {
    // Total por mes: un recibo partido en dos cargos el mismo mes cuenta como uno.
    const porMes = new Map<number, Centimos>();
    for (const g of lista) porMes.set(indiceMes(g), (porMes.get(indiceMes(g)) ?? 0) + importeGasto(g));
    // Varias compras al mes no son un compromiso (el supermercado).
    if (lista.length > porMes.size * 1.5) continue;
    const meses = [...porMes.keys()].sort((a, b) => a - b);
    if (meses.length < 2) continue;
    const huecos = meses.slice(1).map((m, i) => m - (meses[i] ?? m));
    const periodicidad = (Object.keys(PASOS) as Periodicidad[]).find((p) => huecos.filter((h) => h === PASOS[p]).length >= Math.max(1, huecos.length * 0.75));
    if (!periodicidad) continue;
    const importes = [...porMes.values()];
    const med = mediana(importes);
    if (med <= 0 || !importes.every((i) => Math.abs(i - med) <= med * TOLERANCIA)) continue;
    const ultimo = meses[meses.length - 1] ?? 0;
    // Si hace más de dos periodos que no se cobra, probablemente ya no existe.
    if (indiceMes(hoy) - ultimo > PASOS[periodicidad] * 2) continue;
    const muestra = lista[lista.length - 1];
    if (!muestra) continue;
    const nombre = muestra.comercio ?? muestra.nota.trim();
    if (yaGuardados.has(normalizarClave(nombre))) continue;
    out.push({
      clave,
      nombre,
      categoriaId: muestra.categoriaId,
      importe: med,
      periodicidad,
      ultimoAnio: Math.floor(ultimo / 12),
      ultimoMes: (ultimo % 12) + 1,
      veces: meses.length,
    });
  }
  return out.sort((a, b) => b.importe - a.importe);
}

/** Meses en los que toca pagar el compromiso entre `desde` y `hasta` (incluidos). */
export function proximosCargos(c: Pick<Compromiso, 'periodicidad' | 'ultimoAnio' | 'ultimoMes'>, desde: Periodo, hasta: Periodo): Periodo[] {
  const out: Periodo[] = [];
  const paso = PASOS[c.periodicidad];
  let p = sumarMeses({ anio: c.ultimoAnio, mes: c.ultimoMes }, paso);
  while (compararPeriodos(p, desde) < 0) p = sumarMeses(p, paso);
  while (compararPeriodos(p, hasta) <= 0 && out.length < 400) {
    out.push(p);
    p = sumarMeses(p, paso);
  }
  return out;
}

/** Coste mensual equivalente (un recibo anual de 120 € son 10 € al mes). */
export function costeMensual(c: Pick<Compromiso, 'importe' | 'periodicidad'>): Centimos {
  return Math.round(c.importe / PASOS[c.periodicidad]);
}

export function claveMes(p: Periodo): string {
  return idMes(p.anio, p.mes);
}
