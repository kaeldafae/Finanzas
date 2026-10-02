import type { Centimos } from '../dinero';
import type { Periodo } from '../modelo';
import { agruparLineas, esImporte, type Linea, type TextoPdf } from './pdf';
import { deducirDecimal, normalizarTexto, parsearFecha, parsearImporteBanco } from './texto';

/**
 * Lector de nóminas en PDF. El recibo de salarios sigue un modelo oficial (Orden ESS/2098/2014), así que
 * los totales se localizan por su rótulo, sin IA. Solo se acepta si cuadra al céntimo:
 * total devengado − total a deducir = líquido a percibir.
 */

export interface DatosNomina {
  bruto: Centimos;
  seguridadSocial: Centimos;
  irpf: Centimos;
  /** Anticipos, embargos y otras deducciones que no son cotización ni IRPF. */
  otrasDeducciones: Centimos;
  neto: Centimos;
  periodo: Periodo | null;
  /** Empresa y CIF tal como aparecen en la nómina (para elegir o crear el pagador). */
  empresa: string | null;
  cif: string | null;
  avisos: string[];
}

export type LecturaNomina = { ok: true; nomina: DatosNomina } | { ok: false; motivo: string };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const R_BRUTO = /total devengado|total devengos|total bruto|importe bruto/;
const R_DEDUCIR = /total a deducir|total deducciones/;
const R_NETO = /liquido (total )?a percibir|liquido total|neto a percibir|total a percibir|total liquido/;
const R_IRPF = /impuesto sobre la renta|\bi\.? ?r\.? ?p\.? ?f\b|retencion (de )?irpf|retencion a cuenta/;
const R_SS = /contingencias comunes|desempleo|formacion profesional|\bmei\b|mecanismo de equidad|horas extra/;

/** Importe en la línea: el primero a la derecha del rótulo (totales) o el último de la línea (detalle). */
function importeDe(l: Linea, re: RegExp, decimal: ',' | '.', ultimo: boolean): Centimos | null {
  const i = l.celdas.findIndex((c) => re.test(normalizarTexto(c.texto)));
  if (i < 0) return null;
  const rotulo = l.celdas[i];
  if (!rotulo) return null;
  const derecha = l.celdas.slice(i + 1).filter((c) => esImporte(c.texto));
  const elegido = ultimo ? derecha[derecha.length - 1] : derecha[0];
  if (elegido) return parsearImporteBanco(elegido.texto, decimal);
  // El rótulo y la cifra en el mismo fragmento: "TOTAL DEVENGADO 1.850,00".
  const m = /(-?[\d.,]+)\s*€?\s*$/.exec(rotulo.texto);
  return m?.[1] ? parsearImporteBanco(m[1], decimal) : null;
}

function periodoDe(texto: string): Periodo | null {
  const lineas = texto.split('\n').map(normalizarTexto);
  const n = lineas.join('\n');
  const linea = lineas.find((l) => /periodo|liquidacion|mensual|mes de/.test(l)) ?? '';
  const fecha = /(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/.exec(linea);
  const iso = fecha?.[1] ? parsearFecha(fecha[1]) : null;
  if (iso) return { anio: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)) };
  const m = new RegExp(`\\b(${MESES.join('|')})\\s+(?:de\\s+)?(20\\d{2})\\b`).exec(n);
  if (m?.[1] && m[2]) return { anio: Number(m[2]), mes: MESES.indexOf(m[1]) + 1 };
  return null;
}

/** "Empresa: HOTELES IBIZA SL" y el CIF (letra + 7 cifras + control) de la cabecera de la nómina. */
function empresaDe(lineas: readonly string[]): { empresa: string | null; cif: string | null } {
  let empresa: string | null = null;
  let cif: string | null = null;
  for (const l of lineas.slice(0, 40)) {
    const m = /\b(?:empresa|razon social|razón social)\s*:?\s*(.+?)(?=\s{2,}|\s+(?:c\.?i\.?f|n\.?i\.?f|domicilio|periodo|centro)\b|$)/i.exec(l);
    if (!empresa && m?.[1] && m[1].trim().length >= 3) empresa = m[1].trim().replace(/[.,;:]+$/, '');
    const c = /\b([ABCDEFGHJNPQRSUVW])[- ]?(\d{7})[- ]?([0-9A-J])\b/.exec(l.toUpperCase());
    if (!cif && c && /c\.?i\.?f|n\.?i\.?f|empresa/i.test(l)) cif = `${c[1] ?? ''}${c[2] ?? ''}${c[3] ?? ''}`;
  }
  return { empresa, cif };
}

export function leerNomina(textos: readonly TextoPdf[]): LecturaNomina {
  const lineas = agruparLineas(textos);
  const texto = lineas.map((l) => l.texto).join('\n');
  const decimal = deducirDecimal(lineas.flatMap((l) => l.celdas.filter((c) => esImporte(c.texto)).map((c) => c.texto)));
  const buscar = (re: RegExp, ultimo: boolean): Centimos | null => {
    for (const l of lineas) {
      const v = importeDe(l, re, decimal, ultimo);
      if (v !== null) return Math.abs(v);
    }
    return null;
  };
  const bruto = buscar(R_BRUTO, false);
  const neto = buscar(R_NETO, false);
  if (bruto === null || neto === null) return { ok: false, motivo: 'No encuentro el total devengado o el líquido a percibir.' };
  const irpf = buscar(R_IRPF, true) ?? 0;
  let deducciones = buscar(R_DEDUCIR, false);

  // Cotizaciones del trabajador: solo las líneas antes del total a deducir (las de la empresa van debajo).
  const fin = lineas.findIndex((l) => R_DEDUCIR.test(normalizarTexto(l.texto)));
  const zona = fin >= 0 ? lineas.slice(0, fin) : lineas;
  let ss = 0;
  for (const l of zona) {
    const v = importeDe(l, R_SS, decimal, true);
    if (v !== null) ss += Math.abs(v);
  }
  const avisos: string[] = [];
  if (deducciones === null) deducciones = bruto - neto;
  if (bruto - deducciones !== neto) {
    return { ok: false, motivo: 'Los totales no cuadran (devengado − deducciones ≠ líquido). No se importa.' };
  }
  if (ss === 0 || ss + irpf > deducciones) {
    ss = deducciones - irpf;
    avisos.push('No se distinguen las cotizaciones línea a línea: Seguridad Social = deducciones − IRPF.');
  }
  const otrasDeducciones = deducciones - ss - irpf;
  if (otrasDeducciones > 0) avisos.push('Hay otras deducciones (anticipos, embargos…) que no son cotización ni IRPF.');
  if (irpf === 0) avisos.push('No aparece retención de IRPF.');
  const periodo = periodoDe(texto);
  const { empresa, cif } = empresaDe(lineas.map((l) => l.texto));
  if (!periodo) avisos.push('No encuentro el mes de la nómina: elígelo antes de aplicarla.');
  return { ok: true, nomina: { bruto, seguridadSocial: ss, irpf, otrasDeducciones, neto, periodo, empresa, cif, avisos } };
}

/**
 * Busca el ingreso del banco que corresponde a la nómina: mismo neto al céntimo, en el mes de la nómina
 * o en el siguiente (la nómina de mayo se cobra a menudo a primeros de junio). Prefiere los que están
 * pendientes de completar.
 */
export function emparejarNomina<T extends { id: string; anio: number; mes: number; neto: Centimos; pendienteNomina?: boolean; borrado?: boolean }>(
  n: Pick<DatosNomina, 'neto'>,
  periodo: Periodo,
  ingresos: readonly T[],
): T | null {
  const siguiente = periodo.mes === 12 ? { anio: periodo.anio + 1, mes: 1 } : { anio: periodo.anio, mes: periodo.mes + 1 };
  const candidatos = ingresos.filter(
    (i) => !i.borrado && i.neto === n.neto && ((i.anio === periodo.anio && i.mes === periodo.mes) || (i.anio === siguiente.anio && i.mes === siguiente.mes)),
  );
  return candidatos.find((i) => i.pendienteNomina) ?? candidatos[0] ?? null;
}
