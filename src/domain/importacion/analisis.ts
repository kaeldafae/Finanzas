import { sumar, type Centimos } from '../dinero';
import { importeGasto, type Gasto } from '../modelo';
import type { Decision, FilasImportacion, MovimientoPropuesto } from './importar';

/**
 * Comprobaciones de seguridad antes de guardar una importación.
 *  - Conservación: cada céntimo de los movimientos incluidos acaba exactamente en un sitio.
 *  - Coherencia: avisos de cosas que suelen ser errores de clasificación.
 */

export interface Conservacion {
  ok: boolean;
  movimientos: number;
  filas: number;
  totalMovimientos: Centimos;
  totalFilas: Centimos;
}

/** Suma con signo de lo que se va a guardar: salidas negativas, entradas positivas. */
function totalFilas(f: FilasImportacion): Centimos {
  return (
    -sumar(f.gastos.map(importeGasto)) +
    sumar(f.ingresos.map((i) => i.neto)) +
    sumar(f.extras.map((e) => e.importe)) +
    sumar(f.traspasos.map((t) => t.importe))
  );
}

export function comprobarConservacion(movs: readonly MovimientoPropuesto[], decisiones: ReadonlyMap<string, Decision>, filas: FilasImportacion): Conservacion {
  const incluidos = movs.filter((m) => !m.duplicado && decisiones.get(m.id)?.incluir);
  const totalMovimientos = sumar(incluidos.map((m) => m.importe));
  const t = totalFilas(filas);
  const n = filas.gastos.length + filas.ingresos.length + filas.extras.length + filas.traspasos.length;
  return { ok: t === totalMovimientos && n === incluidos.length, movimientos: incluidos.length, filas: n, totalMovimientos, totalFilas: t };
}

export interface AvisoCoherencia {
  tipo: 'comercio-dividido' | 'importe-raro' | 'fijo-puntual';
  texto: string;
  ids: string[];
}

function mediana(v: readonly number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? (o[m] ?? 0) : ((o[m - 1] ?? 0) + (o[m] ?? 0)) / 2;
}

export function analizarCoherencia(
  movs: readonly MovimientoPropuesto[],
  decisiones: ReadonlyMap<string, Decision>,
  historico: readonly Gasto[],
  nombre: (categoriaId: string) => string,
): AvisoCoherencia[] {
  const avisos: AvisoCoherencia[] = [];
  const gastos = movs.filter((m) => {
    const d = decisiones.get(m.id);
    return !m.duplicado && d?.incluir && d.destino === 'gasto' && d.categoriaId;
  });

  // 1. Mismo comercio en categorías distintas dentro de la importación.
  const porComercio = new Map<string, MovimientoPropuesto[]>();
  for (const m of gastos) {
    const k = m.propuesta.limpio.clave;
    if (!k) continue;
    porComercio.set(k, [...(porComercio.get(k) ?? []), m]);
  }
  for (const lista of porComercio.values()) {
    const cats = new Set(lista.map((m) => decisiones.get(m.id)?.categoriaId));
    if (cats.size > 1) {
      avisos.push({
        tipo: 'comercio-dividido',
        texto: `«${lista[0]?.propuesta.limpio.comercio ?? ''}» está en ${[...cats].map((c) => nombre(c ?? '')).join(' y ')}. ¿Es correcto?`,
        ids: lista.map((m) => m.id),
      });
    }
  }

  // 2. Importe muy por encima de lo habitual en esa categoría (con al menos 5 gastos de referencia).
  const referencia = new Map<string, number[]>();
  for (const g of historico) {
    if (g.borrado || g.devolucion) continue;
    referencia.set(g.categoriaId, [...(referencia.get(g.categoriaId) ?? []), g.importe]);
  }
  for (const m of gastos) {
    if (m.importe >= 0) continue;
    const cat = decisiones.get(m.id)?.categoriaId ?? '';
    const ref = referencia.get(cat);
    if (!ref || ref.length < 5) continue;
    const med = mediana(ref);
    if (-m.importe > med * 5 && -m.importe > 5000) {
      avisos.push({
        tipo: 'importe-raro',
        texto: `${m.propuesta.limpio.comercio}: ${(-m.importe / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })} es mucho para ${nombre(cat)} (lo normal ronda ${(med / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}). ¿Es esa la categoría?`,
        ids: [m.id],
      });
    }
  }

  // 3. Marcado como fijo pero solo aparece una vez y es grande.
  for (const m of gastos) {
    const d = decisiones.get(m.id);
    if (d?.tipoGasto === 'Fijo' && !m.recurrente && -m.importe > 30000) {
      avisos.push({ tipo: 'fijo-puntual', texto: `${m.propuesta.limpio.comercio} está como gasto fijo pero solo aparece una vez. ¿No será Extra?`, ids: [m.id] });
    }
  }
  return avisos;
}
