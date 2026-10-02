import { sumar, type Centimos } from './dinero';
import { proximosCargos } from './compromisos';
import { compararPeriodos, idMes, importeGasto, nombreMes, sumarMeses, type Periodo } from './modelo';
import type { DatosFinancieros, IndiceMeses, ResumenMes } from './resumen';

/**
 * Previsión de caja mes a mes. Cada cifra lleva su origen y nunca se mezclan:
 *  - planificado: lo que ya tienes apuntado como previsto (nóminas previstas, gastos futuros) y tus pagos recurrentes.
 *  - estimado: lo que calcula la app a partir de tu historia (mismo mes del año anterior o mediana reciente).
 *  - simulado: los "¿y si…?" que pruebas; no se guardan.
 *
 * Con trabajo de temporada los ingresos no son lineales: por eso se usa el mismo mes del año anterior
 * antes que una media, y se dice siempre qué se ha usado.
 */

export type OrigenPrevision = 'planificado' | 'estimado' | 'simulado';
export type Confianza = 'alta' | 'media' | 'baja';

export interface LineaPrevision {
  concepto: string;
  /** Con signo: positivo entra, negativo sale. */
  importe: Centimos;
  origen: OrigenPrevision;
  detalle: string;
}

export interface MesPrevision extends Periodo {
  ingresos: Centimos;
  gastos: Centimos;
  resultado: Centimos;
  saldoFinal: Centimos;
  confianza: Confianza;
  lineas: LineaPrevision[];
}

export interface Simulacion {
  /** Gasto que dejarías de hacer cada mes (o de más, si es negativo). */
  menosGastoMensual: Centimos;
  /** Ingreso adicional cada mes. */
  masIngresoMensual: Centimos;
}

export interface Prevision {
  dias: number;
  saldoInicial: Centimos;
  saldoFinal: Centimos;
  minimo: { periodo: Periodo; saldo: Centimos };
  meses: MesPrevision[];
  supuestos: string[];
  datosUsados: string;
}

export const HORIZONTES = [30, 90, 180, 365] as const;

function mediana(v: readonly number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const n = o.length;
  if (n === 0) return 0;
  const m = Math.floor(n / 2);
  return n % 2 ? (o[m] ?? 0) : Math.round(((o[m - 1] ?? 0) + (o[m] ?? 0)) / 2);
}

const etiqueta = (p: Periodo) => `${nombreMes(p.mes).toLowerCase()} ${p.anio}`;

export interface EntradaPrevision {
  datos: DatosFinancieros;
  indice: IndiceMeses;
  /** Serie de meses ya resumidos (al menos los reales hasta hoy). */
  serie: readonly ResumenMes[];
  /** Saldo acumulado al cierre del mes actual. */
  saldoActual: Centimos;
  hoy: Periodo;
  dias: number;
  simulacion?: Simulacion;
}

export function prever(e: EntradaPrevision): Prevision {
  const { datos, indice, serie, hoy } = e;
  const nMeses = Math.max(1, Math.round(e.dias / 30.4));
  const reales = serie.filter((m) => m.estado === 'real' && compararPeriodos(m, hoy) <= 0);
  const recientes = reales.slice(-6);
  const porMes = new Map(serie.map((m) => [idMes(m.anio, m.mes), m]));
  const compromisos = datos.compromisos.filter((c) => c.activo && !c.borrado);
  const categoriasComprometidas = new Set(compromisos.map((c) => c.categoriaId));
  const nombreCategoria = (id: string) => datos.categorias.find((c) => c.id === id)?.nombre ?? 'Sin categoría';

  // Gasto sin compromisos de un mes real: lo que no es un pago recurrente que ya prevemos aparte.
  const gastoLibre = (p: Periodo) =>
    sumar((indice.gastos.get(idMes(p.anio, p.mes)) ?? []).filter((g) => !categoriasComprometidas.has(g.categoriaId)).map(importeGasto));
  const medianaIngresos = mediana(recientes.filter((m) => m.ingresos > 0).map((m) => m.ingresos));
  const medianaGastoLibre = mediana(recientes.filter((m) => m.gastos > 0).map(gastoLibre));

  const supuestos = new Set<string>();
  const meses: MesPrevision[] = [];
  let saldo = e.saldoActual;
  let minimo = { periodo: hoy, saldo };

  for (let i = 1; i <= nMeses; i++) {
    const p = sumarMeses(hoy, i);
    const k = idMes(p.anio, p.mes);
    const anterior = porMes.get(idMes(p.anio - 1, p.mes));
    const anteriorReal = anterior?.estado === 'real' ? anterior : undefined;
    const lineas: LineaPrevision[] = [];
    let confianza: Confianza = 'alta';
    const bajar = (c: Confianza) => {
      const orden: Confianza[] = ['alta', 'media', 'baja'];
      if (orden.indexOf(c) > orden.indexOf(confianza)) confianza = c;
    };

    // --- Ingresos
    const previstos = (indice.ingresos.get(k) ?? []).filter((x) => x.estado === 'Previsto');
    const extrasApuntados = indice.extras.get(k) ?? [];
    if (previstos.length > 0 || extrasApuntados.length > 0) {
      const total = sumar(previstos.map((x) => x.neto)) + sumar(extrasApuntados.map((x) => x.importe));
      lineas.push({ concepto: 'Ingresos previstos', importe: total, origen: 'planificado', detalle: 'Apuntados como previstos en ese mes' });
    } else if (anteriorReal) {
      lineas.push({ concepto: 'Ingresos', importe: anteriorReal.ingresos, origen: 'estimado', detalle: `Como en ${etiqueta(anteriorReal)}` });
      supuestos.add('Ingresos sin prever: los del mismo mes del año anterior (trabajo de temporada).');
      bajar('media');
    } else {
      lineas.push({ concepto: 'Ingresos', importe: medianaIngresos, origen: 'estimado', detalle: `Mediana de los últimos ${recientes.length} meses reales con ingresos` });
      supuestos.add('Sin datos del año anterior: ingresos con la mediana reciente. Revisa los meses de temporada.');
      bajar('baja');
    }

    // --- Gastos ya apuntados para ese mes
    const apuntados = indice.gastos.get(k) ?? [];
    const categoriasApuntadas = new Set(apuntados.map((g) => g.categoriaId));
    if (apuntados.length > 0) {
      lineas.push({ concepto: 'Gastos ya apuntados', importe: -sumar(apuntados.map(importeGasto)), origen: 'planificado', detalle: `${apuntados.length} gastos` });
    }

    // --- Pagos recurrentes
    for (const c of compromisos) {
      if (categoriasApuntadas.has(c.categoriaId)) continue;
      if (proximosCargos(c, p, p).length === 0) continue;
      lineas.push({ concepto: c.nombre, importe: -c.importe, origen: 'planificado', detalle: `Pago ${c.periodicidad} · ${nombreCategoria(c.categoriaId)}` });
    }

    // --- Resto del gasto
    if (apuntados.length === 0) {
      if (anteriorReal && anteriorReal.gastos > 0) {
        lineas.push({ concepto: 'Gasto variable', importe: -gastoLibre(anteriorReal), origen: 'estimado', detalle: `Como en ${etiqueta(anteriorReal)}, sin los pagos recurrentes` });
        bajar('media');
      } else {
        lineas.push({ concepto: 'Gasto variable', importe: -medianaGastoLibre, origen: 'estimado', detalle: `Mediana de los últimos ${recientes.length} meses reales, sin los pagos recurrentes` });
        bajar(recientes.length >= 3 ? 'media' : 'baja');
      }
    }
    if (compromisos.length === 0) supuestos.add('No hay pagos recurrentes guardados: los fijos van dentro del gasto estimado.');

    // --- Simulación (nunca se mezcla con lo demás: va en su propia línea)
    const s = e.simulacion;
    if (s && (s.menosGastoMensual !== 0 || s.masIngresoMensual !== 0)) {
      lineas.push({ concepto: 'Simulación', importe: s.menosGastoMensual + s.masIngresoMensual, origen: 'simulado', detalle: '¿Y si…?' });
    }

    const ingresos = sumar(lineas.filter((l) => l.importe > 0 && l.origen !== 'simulado').map((l) => l.importe));
    const gastos = -sumar(lineas.filter((l) => l.importe < 0 && l.origen !== 'simulado').map((l) => l.importe));
    const resultado = sumar(lineas.map((l) => l.importe));
    saldo += resultado;
    if (saldo < minimo.saldo) minimo = { periodo: p, saldo };
    meses.push({ ...p, ingresos, gastos, resultado, saldoFinal: saldo, confianza, lineas });
  }

  const primero = reales[0];
  const ultimo = reales[reales.length - 1];
  return {
    dias: e.dias,
    saldoInicial: e.saldoActual,
    saldoFinal: saldo,
    minimo,
    meses,
    supuestos: [...supuestos],
    datosUsados:
      primero && ultimo
        ? `${reales.length} meses reales (${etiqueta(primero)} – ${etiqueta(ultimo)}) y ${compromisos.length} pagos recurrentes`
        : 'Aún no hay meses reales: la previsión solo usa lo planificado',
  };
}
