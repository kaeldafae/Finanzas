import type { Centimos } from '../dinero';
import type { ClaveCategoria, TipoGasto, TipoPagador } from '../modelo';
import { buscarEnDiccionario, esAmbiguo } from './diccionario';
import type { MovimientoBruto } from './formatos';
import { normalizarTexto } from './texto';

// --- Limpieza del concepto -------------------------------------------------------------------

export interface ConceptoLimpio {
  /** Texto para mostrar: comercio sin tarjetas, fechas, referencias ni nombres de personas. */
  comercio: string;
  /** Clave para reglas aprendidas (p. ej. "mercadona"). Vacía si no hay comercio identificable. */
  clave: string;
  /** Texto normalizado para buscar en el diccionario. */
  busqueda: string;
  /** Bizum o transferencia a/de una persona: el nombre se elimina. */
  persona: 'bizum' | 'transferencia' | null;
}

const PREFIJOS = [
  /^(compra|pago|cargo)\s+(con\s+)?(tarj(eta)?\.?|tarjeta de (credito|debito))\s*/i,
  /^compra\s+(en\s+)?/i,
  /^pago\s+(movil|móvil|contactless|apple pay|google pay)\s+(en\s+)?/i,
  /^pago\s+en\s+/i,
  /^(recibo|adeudo|domiciliacion|domiciliación)\s+(sepa\s+)?(de\s+)?/i,
  /^card payment to\s+/i,
  /^payment (to|from)\s+/i,
];

const PALABRAS_VACIAS = new Set(['sl', 'sa', 'sau', 'slu', 'cb', 'scp', 'sll', 'es', 'esp', 'spain', 'espana', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'the', 'ltd', 'inc', 'srl', 'gmbh']);

function titulo(t: string): string {
  return t.toLowerCase().replace(/(^|[\s/.-])(\p{L})/gu, (_m, sep: string, l: string) => sep + l.toUpperCase());
}

/** Revolut describe las transferencias con el nombre de la otra persona: "To Juan Pérez", "Pago de Ana". */
const PERSONA_REVOLUT = /^(to|para|transfer to|transferencia a|enviado a|from|payment from|transfer from|transferencia de|recibido de|de parte de)\s/;

export function limpiarConcepto(concepto: string, importe: Centimos, tipoBanco: string | null = null): ConceptoLimpio {
  const n = normalizarTexto(concepto);
  if (/\bbizum\b/.test(n)) {
    // Sin el texto original: lleva el nombre de la otra persona.
    return { comercio: importe < 0 ? 'Bizum enviado' : 'Bizum recibido', clave: '', busqueda: '', persona: 'bizum' };
  }
  const aHucha = /\b(pocket|savings|vault|hucha)\b/.test(n);
  const esTransferencia =
    (/\b(transferencia|transf\.?|trf\.?|transfer)\b/.test(n) || tipoBanco === 'TRANSFER' || PERSONA_REVOLUT.test(n) || (importe > 0 && /^pago de\s/.test(n))) &&
    !/\b(revolut|nomina|sepe|prestacion)\b/.test(n) &&
    !aHucha;

  let t = concepto;
  for (const p of PREFIJOS) t = t.replace(p, '');
  t = t
    .replace(/\b\d{4}[\s*xX]{4,}[\dxX*\s]{0,8}\b/g, ' ') // tarjetas enmascaradas
    .replace(/\b\d{6,}\b/g, ' ') // referencias, números de tarjeta, NIF numéricos
    .replace(/\b[A-Z]{2}\d{2}[\d\s]{10,}\b/g, ' ') // IBAN
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, ' ') // fechas
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ') // horas
    .replace(/\b(fecha|f\.)\s*(operacion|op\.?|valor)\b/gi, ' ')
    .replace(/\b(n[ºo°]?\.?\s*recibo|referencia|ref\.?|concepto|ordenante|beneficiario)\b.*$/gi, ' ')
    .replace(/[*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (esTransferencia) {
    return { comercio: importe < 0 ? 'Transferencia enviada' : 'Transferencia recibida', clave: '', busqueda: '', persona: 'transferencia' };
  }

  const busqueda = normalizarTexto(t);
  const palabras = busqueda.split(/[^a-z0-9&]+/).filter((w) => w.length >= 2 && !PALABRAS_VACIAS.has(w) && !/^\d+$/.test(w));
  const primera = palabras[0] ?? '';
  const clave = primera.length >= 5 ? primera : palabras.slice(0, 2).join(' ');
  const comercio = titulo(t).slice(0, 40) || 'Movimiento';
  return { comercio, clave, busqueda, persona: null };
}

// --- Clasificación ---------------------------------------------------------------------------

export type Destino = 'gasto' | 'ingreso' | 'extra' | 'interno' | 'hucha' | 'divisa';

export interface Propuesta {
  destino: Destino;
  categoria: ClaveCategoria | null;
  /** Si la categoría viene de una regla aprendida, su id directo. */
  categoriaId: string | null;
  tipoGasto: TipoGasto;
  pagador: TipoPagador | null;
  devolucion: boolean;
  /** 0..1: por debajo de UMBRAL_REVISION se pide revisar. */
  confianza: number;
  motivo: string;
  limpio: ConceptoLimpio;
}

export const UMBRAL_REVISION = 0.8;

export interface ReglaAprendida {
  categoriaId: string;
  tipo: TipoGasto;
}

const FIJAS: readonly ClaveCategoria[] = ['alquiler', 'suministros', 'movil', 'seguros', 'suscripciones', 'deudas'];

function porComercio(limpio: ConceptoLimpio, reglas: ReadonlyMap<string, ReglaAprendida>, devolucion: boolean): Propuesta {
  const regla = limpio.clave ? reglas.get(limpio.clave) : undefined;
  if (regla) {
    return { destino: 'gasto', categoria: null, categoriaId: regla.categoriaId, tipoGasto: regla.tipo, pagador: null, devolucion, confianza: 1, motivo: 'Regla aprendida', limpio };
  }
  const entrada = buscarEnDiccionario(limpio.busqueda);
  if (entrada) {
    const ambiguo = esAmbiguo(limpio.busqueda);
    return {
      destino: 'gasto',
      categoria: entrada.categoria,
      categoriaId: null,
      tipoGasto: entrada.tipo ?? (FIJAS.includes(entrada.categoria) ? 'Fijo' : 'Variable'),
      pagador: null,
      devolucion,
      confianza: ambiguo ? 0.4 : 0.9,
      motivo: ambiguo ? 'Comercio genérico: puede ser cualquier cosa' : 'Comercio conocido',
      limpio,
    };
  }
  return { destino: 'gasto', categoria: 'otros', categoriaId: null, tipoGasto: 'Variable', pagador: null, devolucion, confianza: 0.2, motivo: 'Comercio desconocido', limpio };
}

function propuesta(destino: Destino, limpio: ConceptoLimpio, confianza: number, motivo: string, extra: Partial<Propuesta> = {}): Propuesta {
  return { destino, categoria: null, categoriaId: null, tipoGasto: 'Variable', pagador: null, devolucion: false, confianza, motivo, limpio, ...extra };
}

export function clasificar(m: MovimientoBruto, reglas: ReadonlyMap<string, ReglaAprendida>): Propuesta {
  const limpio = limpiarConcepto(m.concepto, m.importe, m.tipoBanco);
  const n = normalizarTexto(m.concepto);
  const tipo = m.tipoBanco ?? '';
  const producto = normalizarTexto(m.producto ?? '');
  const entra = m.importe > 0;

  // 1. Lo que dice el propio banco (Revolut indica el tipo de operación).
  if (tipo === 'EXCHANGE') return propuesta('divisa', limpio, 1, 'Cambio de divisa');
  if (/savings|ahorro|pocket|hucha|vault/.test(producto) || /\b(pocket|vault|hucha)\b|\b(to|from) savings\b/.test(n)) {
    return propuesta('hucha', limpio, 0.95, 'Movimiento de hucha o ahorro');
  }
  if (tipo === 'TOPUP') return propuesta('interno', limpio, 0.95, 'Recarga desde otra cuenta tuya');
  if (tipo === 'ATM') return propuesta('gasto', limpio, 0.98, 'Retirada en cajero', { categoria: 'efectivo' });
  if (tipo === 'FEE') return propuesta('gasto', limpio, 0.98, 'Comisión del banco', { categoria: 'comisiones' });
  if (tipo === 'CASHBACK' || tipo === 'REWARD' || tipo === 'INTEREST') return propuesta('extra', limpio, 0.9, 'Recompensa o intereses');
  if (tipo === 'CARD_REFUND' || tipo === 'REFUND') return porComercio(limpio, reglas, true);

  // 2. Conceptos inequívocos.
  if (entra && /\b(sepe|prestacion|prestaciones|desempleo|servicio publico de empleo|inem|subsidio)\b/.test(n)) {
    return propuesta('ingreso', limpio, 0.95, 'Pago del SEPE', { pagador: 'SEPE' });
  }
  if (entra && /\b(nomina|haberes|salario|sueldo)\b/.test(n)) return propuesta('ingreso', limpio, 0.9, 'Nómina', { pagador: 'Empresa' });
  if (/\brevolut\b/.test(n)) return propuesta('interno', limpio, 0.9, 'Traspaso con Revolut');
  if (/\b(traspaso|entre cuentas|cuenta propia|transferencia propia)\b/.test(n)) return propuesta('interno', limpio, 0.85, 'Traspaso entre cuentas');
  if (!entra && /\b(cajero|reintegro|retirada|disposicion efectivo|disp\.? efectivo)\b/.test(n)) {
    return propuesta('gasto', limpio, 0.95, 'Retirada de efectivo', { categoria: 'efectivo' });
  }
  if (!entra && /\b(comision|cuota de mantenimiento|cuota mantenimiento|cuota tarjeta|cuota anual|cuota emision)\b/.test(n)) {
    return propuesta('gasto', limpio, 0.9, 'Comisión bancaria', { categoria: 'comisiones' });
  }
  if (entra && /\b(intereses|liquidacion de intereses|remuneracion)\b/.test(n)) return propuesta('extra', limpio, 0.9, 'Intereses');
  if (/\balquiler\b/.test(n) && !entra) return propuesta('gasto', limpio, 0.85, 'Alquiler', { categoria: 'alquiler', tipoGasto: 'Fijo' });

  // 3. Personas: nunca se adivina para qué era.
  if (limpio.persona) {
    return entra
      ? propuesta('extra', limpio, 0.5, `${limpio.persona === 'bizum' ? 'Bizum' : 'Transferencia'} recibido de una persona: ¿ingreso o te devolvieron algo?`)
      : propuesta('gasto', limpio, 0.5, `${limpio.persona === 'bizum' ? 'Bizum' : 'Transferencia'} a una persona: ¿para qué fue?`, { categoria: 'personas' });
  }

  // 4. Devoluciones de compras en extractos sin tipo.
  if (entra && /\b(devolucion|reembolso|abono compra|anulacion)\b/.test(n)) return porComercio(limpio, reglas, true);

  // 5. Entradas sin identificar: nunca se asumen como ingreso sin revisar.
  if (entra) return propuesta('extra', limpio, 0.4, 'Entrada de dinero sin identificar');

  // 6. Comercio (reglas aprendidas y diccionario).
  return porComercio(limpio, reglas, false);
}
