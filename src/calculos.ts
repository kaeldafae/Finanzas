import { useMemo } from 'react';
import type { Centimos } from './domain/dinero';
import { compararPeriodos, type Periodo } from './domain/modelo';
import { validarPorcentajes } from './domain/reparto';
import {
  estimarColchon,
  gastoMedioMensual,
  serieMeses,
  simularColchon,
  type EstimacionColchon,
  type IndiceMeses,
  type PasoColchon,
  type ResumenMes,
  type SimulacionColchon,
} from './domain/resumen';
import { useEstado } from './estado';

export interface Analisis {
  inicio: Periodo;
  serie: ResumenMes[];
  gastoMedio: Centimos;
  objetivo: Centimos;
  /** null si los porcentajes de reparto no son válidos. */
  real: SimulacionColchon | null;
  proyeccion: SimulacionColchon | null;
  estimacion: EstimacionColchon | null;
  pasoPorMes: Map<string, PasoColchon>;
  errorReparto: string | null;
}

function ultimoPeriodoConDatos(indice: IndiceMeses): Periodo | null {
  let max: Periodo | null = null;
  const claves = [...indice.ingresos.keys(), ...indice.extras.keys(), ...indice.gastos.keys(), ...indice.confirmados];
  for (const k of claves) {
    const [a, m] = k.split('-').map(Number);
    if (a === undefined || m === undefined) continue;
    const p = { anio: a, mes: m };
    if (!max || compararPeriodos(p, max) > 0) max = p;
  }
  return max;
}

export function clavePeriodo(p: Periodo): string {
  return `${p.anio}-${p.mes}`;
}

export function useAnalisis(): Analisis {
  const { indice, ajustes, hoy } = useEstado();
  return useMemo(() => {
    const inicio = { anio: ajustes.inicioAnio, mes: ajustes.inicioMes };
    const ultimo = ultimoPeriodoConDatos(indice);
    let hasta = { anio: hoy.anio, mes: 12 };
    if (ultimo && compararPeriodos(ultimo, hasta) > 0) hasta = { anio: ultimo.anio, mes: 12 };
    const serie = compararPeriodos(inicio, hasta) <= 0 ? serieMeses(indice, inicio, hasta, hoy) : [];
    const gastoMedio = gastoMedioMensual(serie);
    const objetivo = gastoMedio * ajustes.mesesColchon;

    const errorReparto =
      validarPorcentajes(ajustes.repartoIncompleto) ?? validarPorcentajes(ajustes.repartoCompleto);
    const reglas = { incompleto: ajustes.repartoIncompleto, completo: ajustes.repartoCompleto };
    const real = errorReparto ? null : simularColchon(serie, ajustes.ahorroInicial, objetivo, reglas, false);
    const proyeccion = errorReparto ? null : simularColchon(serie, ajustes.ahorroInicial, objetivo, reglas, true);
    const reales = serie.filter((m) => m.estado === 'real');
    const ultimoReal = reales[reales.length - 1];
    const estimacion = real ? estimarColchon(real, objetivo, ultimoReal ? { anio: ultimoReal.anio, mes: ultimoReal.mes } : null) : null;

    const pasoPorMes = new Map<string, PasoColchon>();
    for (const p of proyeccion?.pasos ?? []) pasoPorMes.set(clavePeriodo(p), p);

    return { inicio, serie, gastoMedio, objetivo, real, proyeccion, estimacion, pasoPorMes, errorReparto };
  }, [indice, ajustes, hoy]);
}
