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

/**
 * De dónde sale un movimiento importado: qué archivo (huella SHA-256 abreviada), qué página y línea,
 * cómo se leyó y qué comprobaciones superó. No se guarda el documento ni el concepto del banco.
 */
export interface Evidencia {
  /** Primeros 16 caracteres del SHA-256 del archivo. */
  archivo: string;
  /** Fila del archivo (CSV/Excel) o línea de la tabla (PDF). */
  fila: number;
  pagina?: number;
}

export type MetodoLectura = 'cabeceras' | 'contenido' | 'pdf' | 'manual' | 'texto' | 'ocr' | 'nomina';

/** Archivo leído en una importación, con las comprobaciones que superó. */
export interface ArchivoImportado {
  nombre: string;
  huella: string;
  metodo: MetodoLectura;
  /** Por ejemplo: "saldo fila a fila", "resumen del extracto". */
  verificaciones: string[];
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
  /** Importado del banco: solo se conoce el neto; faltan bruto, SS y retención de la nómina. */
  pendienteNomina?: boolean;
  /** Datos del importador (opcionales: lo apuntado a mano no los tiene). */
  fecha?: string;
  cuenta?: string;
  huella?: string;
  /** Importación de la que viene (para poder deshacerla). */
  importacion?: string;
  evidencia?: Evidencia;
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
  fecha?: string;
  cuenta?: string;
  huella?: string;
  importacion?: string;
  evidencia?: Evidencia;
}

export type TipoGasto = 'Fijo' | 'Variable' | 'Extra';
export const TIPOS_GASTO: readonly TipoGasto[] = ['Fijo', 'Variable', 'Extra'];

/** Claves estables de categorías: el cálculo y el importador las reconocen aunque se renombren. */
export const CLAVES_CATEGORIA = [
  'alquiler', 'suministros', 'movil', 'transporte', 'comida', 'restaurantes', 'seguros', 'suscripciones',
  'deudas', 'ocio', 'ropa', 'salud', 'hogar', 'viajes', 'educacion', 'mascotas', 'efectivo', 'comisiones',
  'personas', 'imprevistos', 'regalos', 'impuestos', 'otros',
] as const;
export type ClaveCategoria = (typeof CLAVES_CATEGORIA)[number];

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
  /** Datos del importador (opcionales: lo apuntado a mano no los tiene). */
  fecha?: string;
  cuenta?: string;
  /** Comercio limpio, sin números de tarjeta ni nombres de personas. */
  comercio?: string;
  /** Huella del movimiento bancario para no importarlo dos veces. */
  huella?: string;
  /** Devolución de una compra: resta en su categoría. */
  devolucion?: boolean;
  importacion?: string;
  evidencia?: Evidencia;
}

/** Importe con signo de un gasto: las devoluciones restan. */
export function importeGasto(g: Pick<Gasto, 'importe' | 'devolucion'>): Centimos {
  return g.devolucion ? -g.importe : g.importe;
}

/** Regla aprendida: un comercio siempre va a la misma categoría. */
export interface Regla extends MetaSync {
  /** Clave normalizada del comercio (p. ej. "mercadona"). */
  id: string;
  categoriaId: Id;
  tipo: TipoGasto;
}

export type TipoTraspaso = 'interno' | 'hucha' | 'divisa';

/** Movimiento bancario que no es ni gasto ni ingreso: se guarda para la trazabilidad y para no reimportarlo. */
export interface Traspaso extends MetaSync {
  /** Huella del movimiento. */
  id: string;
  anio: number;
  mes: number;
  fecha: string;
  cuenta: string;
  /** Con signo: negativo sale de la cuenta, positivo entra. */
  importe: Centimos;
  tipo: TipoTraspaso;
  /** Huella del movimiento emparejado en la otra cuenta, si se encontró. */
  pareja?: string;
  importacion?: string;
  evidencia?: Evidencia;
}

/** Registro de cada importación: permite deshacerla entera. */
export interface Importacion extends MetaSync {
  id: Id;
  /** ISO */
  fecha: string;
  cuentas: string[];
  movimientos: number;
  /** Primer y último día de los movimientos importados. */
  desde: string;
  hasta: string;
  deshecha?: boolean;
  archivos?: ArchivoImportado[];
}

export type Periodicidad = 'mensual' | 'trimestral' | 'anual';
export const PERIODICIDADES: readonly Periodicidad[] = ['mensual', 'trimestral', 'anual'];

/** Pago que se repite (alquiler, recibos, suscripciones, cuotas). Alimenta la previsión. */
export interface Compromiso extends MetaSync {
  id: Id;
  nombre: string;
  categoriaId: Id;
  importe: Centimos;
  periodicidad: Periodicidad;
  /** Mes del último cargo conocido: con la periodicidad, da los siguientes. */
  ultimoAnio: number;
  ultimoMes: number;
  activo: boolean;
  origen: 'detectado' | 'manual';
}

/** Objetivo de ahorro (viaje, compra, colchón aparte...). */
export interface ObjetivoAhorro extends MetaSync {
  id: Id;
  nombre: string;
  importeObjetivo: Centimos;
  /** Lo ya apartado. */
  importeActual: Centimos;
  aportacionMensual: Centimos;
  /** "2027-06" o null si no hay fecha. */
  fechaObjetivo: string | null;
  archivado: boolean;
}

/** Presupuesto mensual de una categoría. */
export interface Presupuesto extends MetaSync {
  /** Id de la categoría. */
  id: Id;
  importe: Centimos;
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
