import { euros } from './dinero';
import type { Ajustes, ClaveCategoria, ParametrosFiscales } from './modelo';

/**
 * Parámetros fiscales por defecto. Son datos editables desde Ajustes, no constantes del cálculo.
 * Revísalos en cada campaña de la renta.
 */
export function parametrosFiscalesPorDefecto(): ParametrosFiscales {
  return {
    ejercicio: 2026,
    revisadoEl: '2026-10-01',
    otrosGastos: euros(2000),
    reduccion: {
      limite1: euros(14852),
      importeMaximo: euros(7302),
      coeficiente1: 17500, // 1,75
      limite2: euros(17673.52),
      importeTramo2: euros(2364.34),
      coeficiente2: 11400, // 1,14
      limite3: euros(19747.5),
    },
    minimoPersonal: euros(5550),
    escalaEstatal: [
      { desde: 0, tipo: 950 },
      { desde: euros(12450), tipo: 1200 },
      { desde: euros(20200), tipo: 1500 },
      { desde: euros(35200), tipo: 1850 },
      { desde: euros(60000), tipo: 2250 },
      { desde: euros(300000), tipo: 2450 },
    ],
    nombreAutonomia: 'Illes Balears',
    escalaAutonomica: [
      { desde: 0, tipo: 900 },
      { desde: euros(10000), tipo: 1125 },
      { desde: euros(18000), tipo: 1425 },
      { desde: euros(30000), tipo: 1750 },
      { desde: euros(48000), tipo: 1900 },
      { desde: euros(70000), tipo: 2175 },
      { desde: euros(90000), tipo: 2275 },
      { desde: euros(120000), tipo: 2375 },
      { desde: euros(175000), tipo: 2475 },
    ],
    alquiler: {
      baseMaxima: euros(33000),
      tramos: [
        { edadMenorQue: 30, porcentaje: 2000, maximo: euros(650) },
        { edadMenorQue: 36, porcentaje: 1500, maximo: euros(530) },
      ],
    },
    sueldosBajos: {
      activa: false,
      limite1: euros(16576),
      importe: euros(340),
      limite2: euros(18276),
      coeficiente: 2000, // 0,2
    },
    obligacion: {
      limiteGeneral: euros(22000),
      limiteVariosPagadores: euros(15876),
      umbralSegundoPagador: euros(1500),
    },
    incluirPropinas: false,
  };
}

export function ajustesPorDefecto(): Ajustes {
  return {
    id: 'ajustes',
    ahorroInicial: 0,
    inicioAnio: 2026,
    inicioMes: 1,
    mesesColchon: 6,
    repartoIncompleto: { colchon: 7000, inversion: 0, objetivos: 0, libre: 3000 },
    repartoCompleto: { colchon: 0, inversion: 5000, objetivos: 2000, libre: 3000 },
    anioNacimiento: null,
    alquilerANombre: false,
    alquilerAnualManual: null,
    fiscal: parametrosFiscalesPorDefecto(),
    ultimaCopia: null,
    tema: 'auto',
  };
}

/**
 * Categorías de fábrica. Los nombres de las que ya existían no cambian: de ellos sale su id fijo
 * (ver idCategoriaPorDefecto) y cambiarlos duplicaría categorías entre dispositivos.
 */
export const CATEGORIAS_POR_DEFECTO: ReadonlyArray<{ nombre: string; clave: ClaveCategoria }> = [
  { nombre: 'Alquiler', clave: 'alquiler' },
  { nombre: 'Suministros', clave: 'suministros' },
  { nombre: 'Móvil/Internet', clave: 'movil' },
  { nombre: 'Transporte', clave: 'transporte' },
  { nombre: 'Comida', clave: 'comida' },
  { nombre: 'Restaurantes y bares', clave: 'restaurantes' },
  { nombre: 'Seguros', clave: 'seguros' },
  { nombre: 'Suscripciones', clave: 'suscripciones' },
  { nombre: 'Deudas', clave: 'deudas' },
  { nombre: 'Ocio', clave: 'ocio' },
  { nombre: 'Ropa/Cuidado', clave: 'ropa' },
  { nombre: 'Salud y farmacia', clave: 'salud' },
  { nombre: 'Hogar', clave: 'hogar' },
  { nombre: 'Viajes', clave: 'viajes' },
  { nombre: 'Educación', clave: 'educacion' },
  { nombre: 'Mascotas', clave: 'mascotas' },
  { nombre: 'Efectivo', clave: 'efectivo' },
  { nombre: 'Comisiones bancarias', clave: 'comisiones' },
  { nombre: 'Personas (Bizum y transferencias)', clave: 'personas' },
  { nombre: 'Imprevistos', clave: 'imprevistos' },
  { nombre: 'Regalos', clave: 'regalos' },
  { nombre: 'Impuestos', clave: 'impuestos' },
  { nombre: 'Otros', clave: 'otros' },
];
