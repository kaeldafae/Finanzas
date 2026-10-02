import { MAX_CENTIMOS, type Centimos } from './dinero';
import { anioValido, mesValido } from './modelo';

export type Errores<K extends string> = Partial<Record<K, string>>;

export function validarImporte(c: Centimos | null, obligatorio = true): string | undefined {
  if (c === null) return obligatorio ? 'Obligatorio' : undefined;
  if (!Number.isInteger(c)) return 'Importe no válido';
  if (c < 0) return 'No puede ser negativo';
  if (c > MAX_CENTIMOS) return 'Importe demasiado grande';
  return undefined;
}

export function validarPeriodo(anio: number, mes: number): string | undefined {
  if (!anioValido(anio)) return 'Año no válido';
  if (!mesValido(mes)) return 'El mes debe estar entre 1 y 12';
  return undefined;
}

export interface FormIngreso {
  anio: number;
  mes: number;
  pagadorId: string;
  bruto: Centimos | null;
  seguridadSocial: Centimos | null;
  retencionIRPF: Centimos | null;
  neto: Centimos | null;
}

export function netoCalculado(bruto: Centimos, ss: Centimos, ret: Centimos): Centimos {
  return bruto - ss - ret;
}

export function validarIngreso(f: FormIngreso): Errores<'periodo' | 'pagadorId' | 'bruto' | 'seguridadSocial' | 'retencionIRPF' | 'neto'> {
  const e: Errores<'periodo' | 'pagadorId' | 'bruto' | 'seguridadSocial' | 'retencionIRPF' | 'neto'> = {};
  const periodo = validarPeriodo(f.anio, f.mes);
  if (periodo) e.periodo = periodo;
  if (!f.pagadorId) e.pagadorId = 'Elige un pagador';
  const b = validarImporte(f.bruto);
  if (b) e.bruto = b;
  const ss = validarImporte(f.seguridadSocial);
  if (ss) e.seguridadSocial = ss;
  const r = validarImporte(f.retencionIRPF);
  if (r) e.retencionIRPF = r;
  const n = validarImporte(f.neto);
  if (n) e.neto = n;
  if (!b && !ss && !r && f.bruto !== null && f.seguridadSocial !== null && f.retencionIRPF !== null) {
    if (f.seguridadSocial + f.retencionIRPF > f.bruto) e.retencionIRPF = 'La Seguridad Social y la retención no pueden superar el bruto';
  }
  return e;
}

/** Diferencia entre el neto escrito y el calculado; null si cuadra. */
export function descuadreNeto(f: Pick<FormIngreso, 'bruto' | 'seguridadSocial' | 'retencionIRPF' | 'neto'>): Centimos | null {
  if (f.bruto === null || f.seguridadSocial === null || f.retencionIRPF === null || f.neto === null) return null;
  const d = f.neto - netoCalculado(f.bruto, f.seguridadSocial, f.retencionIRPF);
  return d === 0 ? null : d;
}
