import { aplicarTasa, dividirRedondeando, sumar, TASA_UNIDAD, type Centimos, type Tasa } from './dinero';
import type { ParametrosFiscales, TipoPagador, Tramo } from './modelo';

/**
 * Estimación del IRPF con rendimientos del trabajo únicamente.
 * Todas las cifras llegan en `ParametrosFiscales`; aquí no hay importes legales fijos.
 */

export interface DatosPagadorRenta {
  pagadorId: string;
  nombre: string;
  tipo: TipoPagador;
  bruto: Centimos;
  seguridadSocial: Centimos;
  retencion: Centimos;
}

export interface EntradaIRPF {
  pagadores: DatosPagadorRenta[];
  /** Propinas del año. Solo se suman si `parametros.incluirPropinas`. */
  propinas: Centimos;
  /** Edad a 31 de diciembre del ejercicio. */
  edad: number | null;
  alquilerANombre: boolean;
  alquilerAnual: Centimos;
}

export interface Obligacion {
  obligado: boolean;
  numPagadores: number;
  /** Suma de lo cobrado del 2.º y siguientes pagadores (ordenados de mayor a menor). */
  segundoYSiguientes: Centimos;
  motivo: string;
}

export type TipoResultado = 'pagar' | 'devolver' | 'cero';

export interface ResultadoIRPF {
  integro: Centimos;
  propinasIncluidas: Centimos;
  seguridadSocial: Centimos;
  rendimientoNetoPrevio: Centimos;
  otrosGastos: Centimos;
  reduccion: Centimos;
  rendimientoNeto: Centimos;
  baseLiquidable: Centimos;
  minimoPersonal: Centimos;
  cuotaEstatal: Centimos;
  cuotaAutonomica: Centimos;
  deduccionAlquiler: Centimos;
  motivoAlquiler: string;
  deduccionSueldosBajos: Centimos;
  cuotaLiquida: Centimos;
  retenciones: Centimos;
  resultado: Centimos;
  tipoResultado: TipoResultado;
  obligacion: Obligacion;
  /** Tipo medio efectivo sobre el íntegro (diezmilésimas). */
  tipoEfectivo: Tasa;
}

/** Reducción por obtención de rendimientos del trabajo (art. 20 LIRPF) sobre el rendimiento neto previo. */
export function reduccionRendimientosTrabajo(rn: Centimos, p: ParametrosFiscales['reduccion']): Centimos {
  let valor: Centimos;
  if (rn <= p.limite1) valor = p.importeMaximo;
  else if (rn <= p.limite2) valor = p.importeMaximo - aplicarTasa(rn - p.limite1, p.coeficiente1);
  else if (rn <= p.limite3) valor = p.importeTramo2 - aplicarTasa(rn - p.limite2, p.coeficiente2);
  else valor = 0;
  return Math.max(0, valor);
}

/** Cuota de una escala sin redondear, en céntimos × diezmilésimas. */
function cuotaEscalaBruta(base: Centimos, escala: readonly Tramo[]): number {
  const tramos = [...escala].sort((a, b) => a.desde - b.desde);
  let total = 0;
  for (let i = 0; i < tramos.length; i++) {
    const tramo = tramos[i];
    if (!tramo || base <= tramo.desde) break;
    const hasta = tramos[i + 1]?.desde ?? Number.POSITIVE_INFINITY;
    total += (Math.min(base, hasta) - tramo.desde) * tramo.tipo;
  }
  return total;
}

/** Aplica una escala a una base y redondea al céntimo. */
export function aplicarEscala(base: Centimos, escala: readonly Tramo[]): Centimos {
  return dividirRedondeando(cuotaEscalaBruta(Math.max(0, base), escala), TASA_UNIDAD);
}

/** escala(base) − escala(min(base, mínimo)); nunca negativa. Un único redondeo. */
export function cuotaConMinimo(base: Centimos, minimo: Centimos, escala: readonly Tramo[]): Centimos {
  const b = Math.max(0, base);
  const m = Math.min(b, Math.max(0, minimo));
  return Math.max(0, dividirRedondeando(cuotaEscalaBruta(b, escala) - cuotaEscalaBruta(m, escala), TASA_UNIDAD));
}

export function obligacionDeclarar(
  brutosPorPagador: readonly Centimos[],
  integro: Centimos,
  p: ParametrosFiscales['obligacion'],
): Obligacion {
  const conIngresos = brutosPorPagador.filter((b) => b > 0).sort((a, b) => b - a);
  const numPagadores = conIngresos.length;
  const segundoYSiguientes = sumar(conIngresos.slice(1));

  if (integro > p.limiteGeneral) {
    return { obligado: true, numPagadores, segundoYSiguientes, motivo: 'Rendimientos del trabajo por encima del límite general.' };
  }
  if (numPagadores >= 2 && segundoYSiguientes > p.umbralSegundoPagador && integro > p.limiteVariosPagadores) {
    return {
      obligado: true,
      numPagadores,
      segundoYSiguientes,
      motivo: 'Más de un pagador, el 2.º y siguientes superan el umbral y el total supera el límite reducido.',
    };
  }
  let motivo = 'Por debajo del límite general y sin segundo pagador relevante.';
  if (numPagadores >= 2 && segundoYSiguientes <= p.umbralSegundoPagador) {
    motivo = 'El 2.º y siguientes pagadores no superan el umbral, así que se aplica el límite general.';
  } else if (numPagadores >= 2) {
    motivo = 'Hay varios pagadores, pero el total no supera el límite reducido.';
  }
  return { obligado: false, numPagadores, segundoYSiguientes, motivo };
}

function deduccionAlquiler(
  entrada: EntradaIRPF,
  base: Centimos,
  cuotaAutonomica: Centimos,
  p: ParametrosFiscales['alquiler'],
): { importe: Centimos; motivo: string } {
  if (!entrada.alquilerANombre) return { importe: 0, motivo: 'El alquiler no está a tu nombre (ver Ajustes).' };
  if (entrada.edad === null) return { importe: 0, motivo: 'Falta el año de nacimiento en Ajustes.' };
  if (entrada.alquilerAnual <= 0) return { importe: 0, motivo: 'No hay alquiler registrado este año.' };
  if (base > p.baseMaxima) return { importe: 0, motivo: 'La base supera el máximo para esta deducción.' };
  const edad = entrada.edad;
  const tramo = [...p.tramos].sort((a, b) => a.edadMenorQue - b.edadMenorQue).find((t) => edad < t.edadMenorQue);
  if (!tramo) return { importe: 0, motivo: 'Por edad no se aplica esta deducción.' };
  const bruta = Math.min(aplicarTasa(entrada.alquilerAnual, tramo.porcentaje), tramo.maximo);
  const importe = Math.min(bruta, cuotaAutonomica);
  const motivo =
    importe < bruta
      ? 'Limitada a la cuota autonómica.'
      : `Menor de ${tramo.edadMenorQue} años: ${tramo.porcentaje / 100} % del alquiler con tope.`;
  return { importe, motivo };
}

export function deduccionSueldosBajos(integro: Centimos, p: ParametrosFiscales['sueldosBajos']): Centimos {
  if (!p.activa) return 0;
  if (integro <= p.limite1) return p.importe;
  if (integro < p.limite2) return Math.max(0, p.importe - aplicarTasa(integro - p.limite1, p.coeficiente));
  return 0;
}

export function calcularIRPF(entrada: EntradaIRPF, p: ParametrosFiscales): ResultadoIRPF {
  const propinasIncluidas = p.incluirPropinas ? Math.max(0, entrada.propinas) : 0;
  const integro = sumar(entrada.pagadores.map((x) => x.bruto)) + propinasIncluidas;
  const seguridadSocial = sumar(entrada.pagadores.map((x) => x.seguridadSocial));
  const retenciones = sumar(entrada.pagadores.map((x) => x.retencion));

  const rendimientoNetoPrevio = Math.max(0, integro - seguridadSocial);
  const otrosGastos = Math.min(p.otrosGastos, rendimientoNetoPrevio);
  const reduccion = reduccionRendimientosTrabajo(rendimientoNetoPrevio, p.reduccion);
  const rendimientoNeto = Math.max(0, rendimientoNetoPrevio - otrosGastos - reduccion);
  const baseLiquidable = rendimientoNeto;

  const cuotaEstatal = cuotaConMinimo(baseLiquidable, p.minimoPersonal, p.escalaEstatal);
  const cuotaAutonomica = cuotaConMinimo(baseLiquidable, p.minimoPersonal, p.escalaAutonomica);

  const alquiler = deduccionAlquiler(entrada, baseLiquidable, cuotaAutonomica, p.alquiler);
  const cuotaTrasAlquiler = cuotaEstatal + cuotaAutonomica - alquiler.importe;
  const deduccionSueldos = Math.min(deduccionSueldosBajos(integro, p.sueldosBajos), Math.max(0, cuotaTrasAlquiler));

  const cuotaLiquida = Math.max(0, cuotaTrasAlquiler - deduccionSueldos);
  const resultado = cuotaLiquida - retenciones;

  const brutosPorPagador = entrada.pagadores.map((x) => x.bruto);
  const obligacion = obligacionDeclarar(brutosPorPagador, integro, p.obligacion);

  return {
    integro,
    propinasIncluidas,
    seguridadSocial,
    rendimientoNetoPrevio,
    otrosGastos,
    reduccion,
    rendimientoNeto,
    baseLiquidable,
    minimoPersonal: p.minimoPersonal,
    cuotaEstatal,
    cuotaAutonomica,
    deduccionAlquiler: alquiler.importe,
    motivoAlquiler: alquiler.motivo,
    deduccionSueldosBajos: deduccionSueldos,
    cuotaLiquida,
    retenciones,
    resultado,
    tipoResultado: resultado > 0 ? 'pagar' : resultado < 0 ? 'devolver' : 'cero',
    obligacion,
    tipoEfectivo: integro > 0 ? dividirRedondeando(cuotaLiquida * TASA_UNIDAD, integro) : 0,
  };
}

export interface Consejo {
  titulo: string;
  texto: string;
}

/** Mensaje principal según resultado y obligación. `formatear` se inyecta para mantener el dominio sin dependencias de UI. */
export function mensajeResultado(r: ResultadoIRPF, formatear: (c: Centimos) => string): Consejo {
  const importe = formatear(Math.abs(r.resultado));
  if (r.tipoResultado === 'devolver') {
    return r.obligacion.obligado
      ? { titulo: `A DEVOLVER: ${importe}`, texto: `Estás obligado a presentarla y te devuelven ${importe}.` }
      : { titulo: `A DEVOLVER: ${importe}`, texto: `No estás obligado, pero preséntala: te devuelven ${importe}.` };
  }
  if (r.tipoResultado === 'pagar') {
    return r.obligacion.obligado
      ? {
          titulo: `A PAGAR: ${importe}`,
          texto: `Estás obligado a presentarla. Puedes pagarlo de una vez o fraccionarlo: 60 % al presentar (junio) y 40 % en noviembre, sin intereses.`,
        }
      : {
          titulo: `Saldría a pagar ${importe}`,
          texto: 'No estás obligado y saldría a pagar: no hace falta presentarla.',
        };
  }
  return {
    titulo: 'Ni a pagar ni a devolver',
    texto: r.obligacion.obligado ? 'Estás obligado a presentarla aunque salga a cero.' : 'No estás obligado a presentarla.',
  };
}

/**
 * Si sale a pagar y quedan nóminas previstas, tipo de retención adicional que habría que pedir
 * a la empresa (art. 88.5 RIRPF permite solicitar un tipo superior) para llegar a cero.
 */
export function retencionAdicionalSugerida(resultado: Centimos, brutoPendiente: Centimos): Tasa | null {
  if (resultado <= 0 || brutoPendiente <= 0) return null;
  // Redondeo hacia arriba a la décima de punto (10 diezmilésimas) para cubrir el importe.
  const exacta = Math.ceil((resultado * TASA_UNIDAD) / brutoPendiente);
  return Math.ceil(exacta / 10) * 10;
}

/** Importes del pago fraccionado. El segundo absorbe el céntimo sobrante para que sumen exacto. */
export function fraccionar6040(total: Centimos): { junio: Centimos; noviembre: Centimos } {
  const junio = aplicarTasa(total, 6000);
  return { junio, noviembre: total - junio };
}
