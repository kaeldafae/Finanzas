import type { Periodo } from '../domain/modelo';

export function hoyPeriodo(ahora = new Date()): Periodo {
  return { anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 };
}

export function diasDesde(iso: string | null, ahora = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((ahora.getTime() - t) / 86_400_000);
}

const formatoFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

export function formatearFecha(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : formatoFecha.format(t);
}

export function fechaArchivo(ahora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
}
