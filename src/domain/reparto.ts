import { TASA_UNIDAD, type Centimos } from './dinero';
import type { Porcentajes } from './modelo';

export const CLAVES_REPARTO = ['colchon', 'inversion', 'objetivos', 'libre'] as const;
export type ClaveReparto = (typeof CLAVES_REPARTO)[number];
export type Reparto = Record<ClaveReparto, Centimos>;

export const ETIQUETAS_REPARTO: Record<ClaveReparto, string> = {
  colchon: 'Colchón',
  inversion: 'Inversión',
  objetivos: 'Objetivos',
  libre: 'Libre',
};

export function validarPorcentajes(p: Porcentajes): string | null {
  for (const clave of CLAVES_REPARTO) {
    const v = p[clave];
    if (!Number.isInteger(v) || v < 0) return `El porcentaje de ${ETIQUETAS_REPARTO[clave]} no es válido.`;
  }
  const total = CLAVES_REPARTO.reduce((s, k) => s + p[k], 0);
  if (total !== TASA_UNIDAD) {
    return `Los porcentajes suman ${(total / 100).toLocaleString('es-ES')} % y deben sumar 100 %.`;
  }
  return null;
}

const vacio = (): Reparto => ({ colchon: 0, inversion: 0, objetivos: 0, libre: 0 });

/**
 * Reparte un importe positivo según porcentajes con el método del mayor resto:
 * las partes suman exactamente el importe, sin céntimos perdidos.
 */
export function repartirPorPorcentajes(importe: Centimos, p: Porcentajes): Reparto {
  const error = validarPorcentajes(p);
  if (error) throw new RangeError(error);
  if (!Number.isInteger(importe) || importe < 0) throw new RangeError('Solo se reparten importes positivos en céntimos.');
  const r = vacio();
  const restos: Array<{ clave: ClaveReparto; resto: number }> = [];
  let asignado = 0;
  for (const clave of CLAVES_REPARTO) {
    const producto = importe * p[clave];
    const parte = Math.floor(producto / TASA_UNIDAD);
    r[clave] = parte;
    asignado += parte;
    restos.push({ clave, resto: producto % TASA_UNIDAD });
  }
  restos.sort((a, b) => b.resto - a.resto);
  for (let i = 0; i < importe - asignado; i++) {
    const destino = restos[i % restos.length];
    if (destino) r[destino.clave] += 1;
  }
  return r;
}

export interface ResultadoReparto {
  reparto: Reparto;
  /** true si este mes completa el colchón. */
  completaColchon: boolean;
  colchonCompletoAntes: boolean;
  aviso: string | null;
}

export interface ReglasReparto {
  incompleto: Porcentajes;
  completo: Porcentajes;
}

/**
 * Reparte el resultado del mes.
 *  - Negativo: no se reparte; todo se resta del colchón.
 *  - Colchón incompleto: reglas de "incompleto". Si con ello se pasaría del objetivo,
 *    se aporta solo lo que falta y el resto se reparte con las reglas de "completo".
 *  - Colchón completo: reglas de "completo".
 * Sin objetivo (no hay gastos registrados) se trata como incompleto, por prudencia.
 */
export function repartirResultado(
  resultado: Centimos,
  colchonActual: Centimos,
  objetivo: Centimos,
  reglas: ReglasReparto,
): ResultadoReparto {
  const errorIncompleto = validarPorcentajes(reglas.incompleto);
  if (errorIncompleto) throw new RangeError(`Reparto con colchón incompleto: ${errorIncompleto}`);
  const errorCompleto = validarPorcentajes(reglas.completo);
  if (errorCompleto) throw new RangeError(`Reparto con colchón completo: ${errorCompleto}`);

  const completoAntes = objetivo > 0 && colchonActual >= objetivo;

  if (resultado <= 0) {
    return {
      reparto: { ...vacio(), colchon: resultado },
      completaColchon: false,
      colchonCompletoAntes: completoAntes,
      aviso: resultado < 0 ? 'Mes en negativo: no se reparte nada y la diferencia se resta del colchón.' : null,
    };
  }

  if (completoAntes) {
    return {
      reparto: repartirPorPorcentajes(resultado, reglas.completo),
      completaColchon: false,
      colchonCompletoAntes: true,
      aviso: null,
    };
  }

  const inicial = repartirPorPorcentajes(resultado, reglas.incompleto);
  const falta = objetivo - colchonActual;
  if (objetivo <= 0 || inicial.colchon < falta) {
    return { reparto: inicial, completaColchon: false, colchonCompletoAntes: false, aviso: null };
  }

  const sobrante = resultado - falta;
  const resto = repartirPorPorcentajes(sobrante, reglas.completo);
  return {
    reparto: {
      colchon: falta + resto.colchon,
      inversion: resto.inversion,
      objetivos: resto.objetivos,
      libre: resto.libre,
    },
    completaColchon: true,
    colchonCompletoAntes: false,
    aviso: '¡Este mes completas el colchón! Lo que sobra se reparte con las reglas de colchón completo.',
  };
}
