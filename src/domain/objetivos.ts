import type { Centimos } from './dinero';
import { compararPeriodos, sumarMeses, type ObjetivoAhorro, type Periodo } from './modelo';

/** Objetivos de ahorro: progreso, fecha estimada y aportación necesaria. Cálculo exacto en céntimos. */

export interface EstadoObjetivo {
  falta: Centimos;
  /** 0..10000 */
  progreso: number;
  completo: boolean;
  /** Con la aportación mensual configurada. */
  fechaEstimada: Periodo | null;
  /** Para llegar a la fecha objetivo (null si no hay fecha o ya pasó). */
  aportacionNecesaria: Centimos | null;
  mesesRestantes: number | null;
}

export function mesesEntre(desde: Periodo, hasta: Periodo): number {
  return (hasta.anio - desde.anio) * 12 + (hasta.mes - desde.mes);
}

export function parsearMes(t: string | null): Periodo | null {
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(t);
  if (!m) return null;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? { anio: Number(m[1]), mes } : null;
}

export function mesesParaAhorrar(falta: Centimos, aportacion: Centimos): number | null {
  if (falta <= 0) return 0;
  if (aportacion <= 0) return null;
  return Math.ceil(falta / aportacion);
}

export function estadoObjetivo(o: Pick<ObjetivoAhorro, 'importeObjetivo' | 'importeActual' | 'aportacionMensual' | 'fechaObjetivo'>, hoy: Periodo): EstadoObjetivo {
  const falta = Math.max(0, o.importeObjetivo - o.importeActual);
  const progreso = o.importeObjetivo > 0 ? Math.min(10_000, Math.floor((o.importeActual * 10_000) / o.importeObjetivo)) : 0;
  const completo = o.importeObjetivo > 0 && falta === 0;
  const meses = mesesParaAhorrar(falta, o.aportacionMensual);
  const fechaEstimada = completo ? hoy : meses === null ? null : sumarMeses(hoy, meses);
  const fecha = parsearMes(o.fechaObjetivo);
  let aportacionNecesaria: Centimos | null = null;
  let mesesRestantes: number | null = null;
  if (fecha && compararPeriodos(fecha, hoy) > 0) {
    mesesRestantes = mesesEntre(hoy, fecha);
    aportacionNecesaria = Math.ceil(falta / mesesRestantes);
  }
  return { falta, progreso, completo, fechaEstimada, aportacionNecesaria, mesesRestantes };
}

export interface EscenarioAhorro {
  aportacion: Centimos;
  meses: number | null;
  fecha: Periodo | null;
}

/** "¿Qué ocurre si ahorro 100, 200 o 300 € al mes?" */
export function escenariosAhorro(falta: Centimos, aportaciones: readonly Centimos[], hoy: Periodo): EscenarioAhorro[] {
  return aportaciones.map((aportacion) => {
    const meses = mesesParaAhorrar(falta, aportacion);
    return { aportacion, meses, fecha: meses === null ? null : sumarMeses(hoy, meses) };
  });
}
