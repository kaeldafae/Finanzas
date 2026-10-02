import { normalizarTexto } from './texto';

/**
 * Qué tipo de documento es, por palabras clave (sin IA): decide qué lector se usa.
 * Solo se importan extractos y nóminas; lo demás se identifica para explicarlo, no para leerlo.
 */
export type TipoDocumento = 'extracto' | 'nomina' | 'factura' | 'desconocido';

const SENALES: Record<Exclude<TipoDocumento, 'desconocido'>, readonly RegExp[]> = {
  nomina: [
    /recibo (individual )?(justificativo )?(del pago )?de salarios/, /\bnomina\b/, /total devengado/, /liquido (total )?a percibir/,
    /periodo de liquidacion/, /base de cotizacion/, /contingencias comunes/, /total a deducir/, /determinacion de las bases/,
  ],
  factura: [/\bfactura\b/, /n[ºo°.]* ?de factura|numero de factura/, /base imponible/, /\biva\b/, /total factura/, /fecha de vencimiento/],
  extracto: [/\bsaldo\b|\bbalance\b/, /extracto|statement|movimientos|transacciones|transactions/, /dinero saliente|money out|cargo|debe/, /dinero entrante|money in|abono|haber/, /iban/],
};

export function tipoDocumento(texto: string): TipoDocumento {
  const n = normalizarTexto(texto.slice(0, 20_000));
  const puntos = (t: keyof typeof SENALES) => SENALES[t].filter((re) => re.test(n)).length;
  const nomina = puntos('nomina');
  const factura = puntos('factura');
  const extracto = puntos('extracto');
  if (nomina >= 3 && nomina >= extracto) return 'nomina';
  if (factura >= 3 && factura > extracto) return 'factura';
  if (extracto >= 2) return 'extracto';
  return 'desconocido';
}
