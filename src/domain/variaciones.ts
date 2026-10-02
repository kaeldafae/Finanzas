import { formatearEuros, sumar, type Centimos } from './dinero';
import { idMes, importeGasto, sumarMeses, type Categoria, type Gasto, type Periodo } from './modelo';
import type { IndiceMeses } from './resumen';

/**
 * Cambios de gasto de un mes frente a tu propia historia. Describe, no juzga: un gasto que sube
 * puede estar justificado. Todo se calcula con tus datos; nada sale del dispositivo.
 */

export type TipoVariacion = 'subida' | 'bajada' | 'inusual' | 'comisiones';

export interface Variacion {
  tipo: TipoVariacion;
  categoriaId: string | null;
  texto: string;
  actual: Centimos;
  referencia: Centimos;
}

const MESES_REFERENCIA = 6;
const MIN_MESES = 3;
const UMBRAL = 0.25;
const MINIMO_DIFERENCIA = 2000;

function mediana(v: readonly number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const n = o.length;
  if (n === 0) return 0;
  const m = Math.floor(n / 2);
  return n % 2 ? (o[m] ?? 0) : Math.round(((o[m - 1] ?? 0) + (o[m] ?? 0)) / 2);
}

const porcentaje = (a: number, b: number) => Math.round(((a - b) / b) * 100);

export function variacionesMes(indice: IndiceMeses, categorias: readonly Categoria[], p: Periodo): Variacion[] {
  const gastosMes = indice.gastos.get(idMes(p.anio, p.mes)) ?? [];
  if (gastosMes.length === 0) return [];
  // Meses anteriores con algún gasto (los huecos sin apuntar no cuentan como "gasto 0").
  const anteriores: Gasto[][] = [];
  for (let i = 1; i <= 24 && anteriores.length < MESES_REFERENCIA; i++) {
    const q = sumarMeses(p, -i);
    const g = indice.gastos.get(idMes(q.anio, q.mes)) ?? [];
    if (g.length > 0) anteriores.push(g);
  }
  if (anteriores.length < MIN_MESES) return [];
  const nombre = (id: string) => categorias.find((c) => c.id === id)?.nombre ?? 'Sin categoría';
  const out: Variacion[] = [];

  const ids = new Set([...gastosMes.map((g) => g.categoriaId), ...anteriores.flat().map((g) => g.categoriaId)]);
  for (const id of ids) {
    const actual = sumar(gastosMes.filter((g) => g.categoriaId === id).map(importeGasto));
    const referencia = mediana(anteriores.map((m) => sumar(m.filter((g) => g.categoriaId === id).map(importeGasto))));
    const diferencia = actual - referencia;
    if (Math.abs(diferencia) < MINIMO_DIFERENCIA) continue;
    if (referencia > 0 && diferencia > referencia * UMBRAL) {
      out.push({ tipo: 'subida', categoriaId: id, actual, referencia, texto: `${nombre(id)}: ${formatearEuros(actual)} este mes, un ${porcentaje(actual, referencia)} % más que tu mediana de los ${anteriores.length} meses anteriores (${formatearEuros(referencia)}).` });
    } else if (referencia === 0 && actual > 0) {
      out.push({ tipo: 'subida', categoriaId: id, actual, referencia, texto: `${nombre(id)}: ${formatearEuros(actual)} este mes; en los ${anteriores.length} meses anteriores no hubo gasto aquí.` });
    } else if (referencia > 0 && -diferencia > referencia * UMBRAL) {
      out.push({ tipo: 'bajada', categoriaId: id, actual, referencia, texto: `${nombre(id)}: ${formatearEuros(actual)} este mes, un ${Math.abs(porcentaje(actual, referencia))} % menos que tu mediana (${formatearEuros(referencia)}).` });
    }
  }

  // Gastos sueltos muy por encima de lo habitual en su categoría.
  for (const g of gastosMes) {
    if (g.devolucion) continue;
    const previos = anteriores.flat().filter((x) => x.categoriaId === g.categoriaId && !x.devolucion).map((x) => x.importe);
    if (previos.length < 3) continue;
    const med = mediana(previos);
    if (g.importe >= med * 3 && g.importe - med >= 5000) {
      out.push({ tipo: 'inusual', categoriaId: g.categoriaId, actual: g.importe, referencia: med, texto: `${g.comercio ?? (g.nota || nombre(g.categoriaId))}: ${formatearEuros(g.importe)}, unas ${Math.round(g.importe / med)} veces lo habitual en ${nombre(g.categoriaId)} (${formatearEuros(med)}).` });
    }
  }

  const comisiones = categorias.filter((c) => c.clave === 'comisiones').map((c) => c.id);
  const totalComisiones = sumar(gastosMes.filter((g) => comisiones.includes(g.categoriaId)).map(importeGasto));
  if (totalComisiones > 0) {
    out.push({ tipo: 'comisiones', categoriaId: comisiones[0] ?? null, actual: totalComisiones, referencia: 0, texto: `Comisiones bancarias este mes: ${formatearEuros(totalComisiones)}.` });
  }

  const orden: Record<TipoVariacion, number> = { subida: 0, inusual: 1, comisiones: 2, bajada: 3 };
  return out.sort((a, b) => orden[a.tipo] - orden[b.tipo] || Math.abs(b.actual - b.referencia) - Math.abs(a.actual - a.referencia));
}
