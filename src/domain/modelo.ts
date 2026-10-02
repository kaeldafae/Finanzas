import type { Centimos, Tasa } from './dinero';

export type Id = string;

/**
 * Metadatos de sincronización. Todos los registros los llevan:
 *  - actualizadoEl: milisegundos de la última modificación (gana la más reciente al fusionar).
 *  - borrado: los borrados se conservan como marca para que no "resuciten" desde otro dispositivo.
 */
export interface MetaSync {
  actualizadoEl?: number;
  borrado?: boolean;
}

export type TipoPagador = 'Empresa' | 'SEPE' | 'Otro';
export const TIPOS_PAGADOR: readonly TipoPagador[] = ['Empresa', 'SEPE', 'Otro'];

export interface Pagador extends MetaSync {
  id: Id;
  nombre: string;
  tipo: TipoPagador;
  /** NIF del pagador, útil para cotejar con el borrador de la AEAT. Opcional. */
  nif?: string;
  archivado: boolean;
}

export type EstadoIngreso = 'Real' | 'Previsto';

export interface Ingreso extends MetaSync {
  id: Id;
  anio: number;
  mes: number;
  pagadorId: Id;
  bruto: Centimos;
  seguridadSocial: Centimos;
  retencionIRPF: Centimos;
  neto: Centimos;
  /** true si el neto se ha escrito a mano (la nómina dice otra cosa). */
  netoManual: boolean;
  estado: EstadoIngreso;
  nota: string;
}

export type ConceptoExtra = 'Propinas' | 'Otro';
export const CONCEPTOS_EXTRA: readonly ConceptoExtra[] = ['Propinas', 'Otro'];

export interface IngresoExtra extends MetaSync {
  id: Id;
  anio: number;
  mes: number;
  concepto: ConceptoExtra;
  importe: Centimos;
  nota: string;
}

export type TipoGasto = 'Fijo' | 'Variable' | 'Extra';
export const TIPOS_GASTO: readonly TipoGasto[] = ['Fijo', 'Variable', 'Extra'];

/** Claves estables de categorías con significado para el cálculo, aunque se renombren. */
export type ClaveCategoria = 'alquiler' | 'impuestos';

export interface Categoria extends MetaSync {
  id: Id;
  nombre: string;
  orden: number;
  clave?: ClaveCategoria;
  archivada: boolean;
}

export interface Gasto extends MetaSync {
  id: Id;
  anio: number;
  mes: number;
  categoriaId: Id;
  importe: Centimos;
  tipo: TipoGasto;
  nota: string;
  /** Marca de origen automático, p. ej. "renta-2026", para no duplicar. */
  origen?: string;
}

/** Un mes "confirmado" existe aunque no tenga movimientos: cuenta como mes a 0, no como hueco. */
export interface MesRegistro extends MetaSync {
  /** "2026-03" */
  id: string;
  anio: number;
  mes: number;
  confirmado: boolean;
}

export interface Tramo {
  desde: Centimos;
  tipo: Tasa;
}

export interface TramoAlquiler {
  edadMenorQue: number;
  porcentaje: Tasa;
  maximo: Centimos;
}

export interface ParametrosFiscales {
  ejercicio: number;
  /** ISO yyyy-mm-dd */
  revisadoEl: string;
  otrosGastos: Centimos;
  reduccion: {
    limite1: Centimos;
    importeMaximo: Centimos;
    coeficiente1: Tasa;
    limite2: Centimos;
    importeTramo2: Centimos;
    coeficiente2: Tasa;
    limite3: Centimos;
  };
  minimoPersonal: Centimos;
  escalaEstatal: Tramo[];
  escalaAutonomica: Tramo[];
  nombreAutonomia: string;
  alquiler: {
    baseMaxima: Centimos;
    tramos: TramoAlquiler[];
  };
  sueldosBajos: {
    activa: boolean;
    limite1: Centimos;
    importe: Centimos;
    limite2: Centimos;
    coeficiente: Tasa;
  };
  obligacion: {
    limiteGeneral: Centimos;
    limiteVariosPagadores: Centimos;
    umbralSegundoPagador: Centimos;
  };
  /** Las propinas son rendimiento del trabajo (art. 17.1 LIRPF). Por defecto no se incluyen en la estimación. */
  incluirPropinas: boolean;
}

/** Porcentajes del reparto en diezmilésimas; deben sumar 10.000 (100 %). */
export interface Porcentajes {
  colchon: Tasa;
  inversion: Tasa;
  objetivos: Tasa;
  libre: Tasa;
}

export type Tema = 'auto' | 'claro' | 'oscuro';

export interface Ajustes extends MetaSync {
  id: 'ajustes';
  ahorroInicial: Centimos;
  /** Mes desde el que cuenta el ahorro inicial. */
  inicioAnio: number;
  inicioMes: number;
  mesesColchon: number;
  repartoIncompleto: Porcentajes;
  repartoCompleto: Porcentajes;
  anioNacimiento: number | null;
  alquilerANombre: boolean;
  /** Si es null, el alquiler anual se toma de los gastos de la categoría Alquiler. */
  alquilerAnualManual: Centimos | null;
  fiscal: ParametrosFiscales;
  ultimaCopia: string | null;
  tema: Tema;
}

/** Campos de Ajustes que son de cada dispositivo y no se sincronizan. */
export const AJUSTES_LOCALES = ['tema', 'ultimaCopia', 'actualizadoEl', 'borrado'] as const;

export function idMes(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

export function mesValido(mes: number): boolean {
  return Number.isInteger(mes) && mes >= 1 && mes <= 12;
}

export function anioValido(anio: number): boolean {
  return Number.isInteger(anio) && anio >= 2000 && anio <= 2100;
}

export const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;

export function nombreMes(mes: number): string {
  return NOMBRES_MES[mes - 1] ?? '';
}

export interface Periodo {
  anio: number;
  mes: number;
}

export function sumarMeses(p: Periodo, n: number): Periodo {
  const indice = p.anio * 12 + (p.mes - 1) + n;
  return { anio: Math.floor(indice / 12), mes: (indice % 12) + 1 };
}

export function compararPeriodos(a: Periodo, b: Periodo): number {
  return a.anio * 12 + a.mes - (b.anio * 12 + b.mes);
}
