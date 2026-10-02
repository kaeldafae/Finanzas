import type { Categoria } from '../modelo';
import { leerRespuesta, type ItemIA, type PropuestaIA } from './ia';

/**
 * Revisión con la IA integrada (modelo que se ejecuta en el propio dispositivo).
 * Lógica pura: el motor se inyecta, así se prueba sin descargar ningún modelo.
 *
 * Seguridad frente a errores:
 *  - Respuesta con esquema JSON obligatorio: la IA solo puede elegir categorías de tu lista.
 *  - Dos pasadas con instrucciones y orden distintos; después se exige acuerdo (ver `consenso`).
 *  - Lotes pequeños: los modelos del navegador tienen un contexto corto.
 */

export interface MensajeIA {
  role: 'system' | 'user';
  content: string;
}

/** Lo único que la lógica necesita del modelo: texto de entrada → texto JSON de salida. */
export interface MotorIA {
  generar(mensajes: MensajeIA[], esquema: string): Promise<string>;
}

export const TAM_LOTE = 8;

const EXCLUIDAS = new Set(['personas', 'efectivo', 'impuestos']);

export function categoriasParaIA(categorias: readonly Categoria[]): string[] {
  return categorias.filter((c) => !c.archivada && !EXCLUIDAS.has(c.clave ?? '')).map((c) => c.nombre);
}

export function esquemaRespuesta(nombres: readonly string[]): string {
  return JSON.stringify({
    type: 'object',
    properties: {
      respuestas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer' },
            categoria: { type: 'string', enum: nombres },
            tipo: { type: 'string', enum: ['Fijo', 'Variable', 'Extra'] },
            seguridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
          },
          required: ['n', 'categoria', 'tipo', 'seguridad'],
        },
      },
    },
    required: ['respuestas'],
  });
}

export function construirMensajes(lote: readonly ItemIA[], nombres: readonly string[], variante: 1 | 2): MensajeIA[] {
  const sistema =
    variante === 1
      ? 'Clasificas gastos bancarios de una persona en España (Ibiza) para su presupuesto doméstico. Responde solo con JSON.'
      : 'Eres un revisor independiente de categorías de gasto. Deduce la categoría solo a partir del nombre del comercio; si no se puede saber, usa "Otros" con seguridad "baja". Responde solo con JSON.';
  const orden = variante === 1 ? lote : [...lote].reverse();
  const lineas = orden.map((it) => `${it.n}. ${it.comercio} (${it.veces} ${it.veces === 1 ? 'vez' : 'veces'}, ${it.rango}${it.sentido === 'entrada' ? ', devolución' : ''})`);
  const usuario = `Categorías posibles: ${nombres.join('; ')}.
Tipo: Fijo (cuota o recibo mensual), Variable o Extra (puntual y grande).
Seguridad: alta, media o baja. No inventes: si dudas, "baja".
Comercios:
${lineas.join('\n')}
Devuelve {"respuestas":[{"n":número,"categoria":"…","tipo":"…","seguridad":"…"}]} con una entrada por comercio.`;
  return [
    { role: 'system', content: sistema },
    { role: 'user', content: usuario },
  ];
}

export interface ResultadoPasada {
  propuestas: Map<number, PropuestaIA>;
  errores: string[];
}

export type Progreso = (hechos: number, total: number, pasada: 1 | 2) => void;

async function pasada(motor: MotorIA, items: readonly ItemIA[], categorias: readonly Categoria[], variante: 1 | 2, progreso: Progreso | undefined, hechosPrevios: number, total: number): Promise<ResultadoPasada> {
  const nombres = categoriasParaIA(categorias);
  const esquema = esquemaRespuesta(nombres);
  const propuestas = new Map<number, PropuestaIA>();
  const errores: string[] = [];
  for (let i = 0; i < items.length; i += TAM_LOTE) {
    const lote = items.slice(i, i + TAM_LOTE);
    let texto: string;
    try {
      texto = await motor.generar(construirMensajes(lote, nombres, variante), esquema);
    } catch (e) {
      errores.push(`La IA falló en un lote (${e instanceof Error ? e.message : String(e)}). Esos comercios quedan para tu revisión.`);
      continue;
    }
    // La misma validación estricta que con las respuestas pegadas a mano.
    const r = leerRespuesta(texto, lote, categorias);
    for (const [n, p] of r.propuestas) propuestas.set(n, p);
    errores.push(...r.errores);
    progreso?.(hechosPrevios + Math.min(i + TAM_LOTE, items.length), total, variante);
  }
  return { propuestas, errores };
}

/** Las dos pasadas, una detrás de otra. El consenso se calcula después con `consenso()`. */
export async function revisarConIALocal(motor: MotorIA, items: readonly ItemIA[], categorias: readonly Categoria[], progreso?: Progreso): Promise<{ r1: ResultadoPasada; r2: ResultadoPasada }> {
  const total = items.length * 2;
  const r1 = await pasada(motor, items, categorias, 1, progreso, 0, total);
  const r2 = await pasada(motor, items, categorias, 2, progreso, items.length, total);
  return { r1, r2 };
}
