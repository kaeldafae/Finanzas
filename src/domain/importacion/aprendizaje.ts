import { DICCIONARIO } from './diccionario';
import { normalizarTexto } from './texto';

/**
 * Clasificador que aprende en el dispositivo (voto ponderado por palabras y trigramas de letras). Se entrena con el diccionario de comercios y, sobre todo, con los gastos que tú ya has
 * clasificado. Así reconoce variantes ("IBIZA FITNESS CENTER" se parece a "Gym Ibiza Fitness") y
 * palabras emparentadas ("braseria" ~ "brasa") sin enviar nada fuera del dispositivo.
 */

export interface Ejemplo {
  texto: string;
  /** Etiqueta: id de categoría. */
  etiqueta: string;
  /** Peso del ejemplo: los tuyos cuentan más que los del diccionario. */
  peso?: number;
  /**
   * Aprender también trigramas de letras (para reconocer variantes del mismo comercio).
   * Solo para tus ejemplos: en el diccionario, terminaciones como "-ería" llevarían a errores.
   */
  trigramas?: boolean;
}

export interface Modelo {
  etiquetas: string[];
  /** Por etiqueta: cuántas veces aparece cada pista (ponderado). */
  conteos: Map<string, Map<string, number>>;
}

export interface Prediccion {
  etiqueta: string;
  /** Probabilidad 0..1 entre las categorías conocidas. */
  probabilidad: number;
  /** Diferencia de probabilidad con la segunda opción. */
  margen: number;
}

/** Lugares y palabras vacías: no dicen nada de la categoría y solo añaden ruido. */
const SIN_SIGNIFICADO = new Set([
  'ibiza', 'eivissa', 'sant', 'santa', 'antoni', 'josep', 'joan', 'eulalia', 'rafel', 'jordi', 'portmany', 'talamanca',
  'palma', 'mallorca', 'menorca', 'formentera', 'baleares', 'balears', 'madrid', 'barcelona', 'valencia',
  'espana', 'spain', 'del', 'las', 'los', 'the', 'and', 'sl', 'sa', 'sau', 'slu', 'can', 'cas', 'ses',
]);

export function caracteristicas(texto: string, trigramas = true): string[] {
  const palabras = normalizarTexto(texto)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !SIN_SIGNIFICADO.has(w));
  const out: string[] = [];
  for (const w of palabras) {
    out.push(`w:${w}`);
    if (!trigramas) continue;
    const b = `^${w}$`;
    for (let i = 0; i + 3 <= b.length; i++) out.push(`t:${b.slice(i, i + 3)}`);
  }
  return out;
}

export function entrenar(ejemplos: readonly Ejemplo[]): Modelo {
  const conteos = new Map<string, Map<string, number>>();
  for (const e of ejemplos) {
    const feats = caracteristicas(e.texto, e.trigramas ?? false);
    if (feats.length === 0) continue;
    const peso = e.peso ?? 1;
    const c = conteos.get(e.etiqueta) ?? new Map<string, number>();
    for (const f of feats) c.set(f, (c.get(f) ?? 0) + peso);
    conteos.set(e.etiqueta, c);
  }
  return { etiquetas: [...conteos.keys()], conteos };
}

/**
 * Cada pista vota por las categorías en las que aparece, en proporción a lo exclusiva que es de cada una
 * ("hotel" solo aparece en Viajes: voto completo; una palabra repartida entre dos categorías: medio voto).
 * Las palabras completas pesan más que los fragmentos. Con pocas pistas por comercio, este voto es más
 * fiable que un modelo probabilístico que reparte la probabilidad entre todas las categorías.
 */
export function predecir(m: Modelo, texto: string): Prediccion | null {
  const todas = caracteristicas(texto);
  const feats = todas.filter((f) => m.etiquetas.some((e) => m.conteos.get(e)?.has(f)));
  if (feats.length === 0) return null;

  const votos = new Map<string, number>();
  for (const f of feats) {
    const peso = f.startsWith('w:') ? 3 : 1;
    let total = 0;
    for (const e of m.etiquetas) total += m.conteos.get(e)?.get(f) ?? 0;
    for (const e of m.etiquetas) {
      const n = m.conteos.get(e)?.get(f) ?? 0;
      if (n > 0) votos.set(e, (votos.get(e) ?? 0) + (peso * n) / total);
    }
  }
  const orden = [...votos.entries()].sort((a, b) => b[1] - a[1]);
  const [primera, segunda] = orden;
  if (!primera) return null;
  const suma = orden.reduce((s, [, v]) => s + v, 0);

  // Respaldo: sin una palabra completa conocida en la categoría ganadora, o el 60 % de los trigramas
  // del texto (variante de un comercio que ya clasificaste), no se sugiere nada.
  const c = m.conteos.get(primera[0]) ?? new Map<string, number>();
  const palabraConocida = feats.some((f) => f.startsWith('w:') && c.has(f));
  const trigramasTexto = todas.filter((f) => f.startsWith('t:'));
  const respaldo = trigramasTexto.filter((f) => c.has(f)).length / Math.max(1, trigramasTexto.length);
  if (!palabraConocida && respaldo < 0.6) return null;

  const p1 = primera[1] / suma;
  const p2 = (segunda?.[1] ?? 0) / suma;
  return { etiqueta: primera[0], probabilidad: p1, margen: p1 - p2 };
}

/**
 * Ejemplos de entrenamiento: los patrones del diccionario (con su categoría resuelta a id) y los
 * gastos que ya tienes clasificados (por su comercio limpio), que pesan el triple.
 */
export function ejemplosDeEntrenamiento(
  categoriaPorClave: (clave: string) => string | null,
  gastos: ReadonlyArray<{ comercio?: string; categoriaId: string; borrado?: boolean }>,
): Ejemplo[] {
  const out: Ejemplo[] = [];
  for (const e of DICCIONARIO) {
    if (e.categoria === 'otros') continue;
    const id = categoriaPorClave(e.categoria);
    if (!id) continue;
    for (const p of e.patrones) out.push({ texto: p, etiqueta: id });
  }
  for (const g of gastos) {
    if (g.borrado || !g.comercio) continue;
    out.push({ texto: g.comercio, etiqueta: g.categoriaId, peso: 3, trigramas: true });
  }
  return out;
}

/** Umbrales: por debajo no se sugiere nada; por encima se pre-rellena (y sigue pidiendo confirmación). */
export const PROBABILIDAD_MINIMA = 0.6;
export const MARGEN_MINIMO = 0.25;

export function sugerencia(m: Modelo, texto: string): Prediccion | null {
  const p = predecir(m, texto);
  return p && p.probabilidad >= PROBABILIDAD_MINIMA && p.margen >= MARGEN_MINIMO ? p : null;
}
