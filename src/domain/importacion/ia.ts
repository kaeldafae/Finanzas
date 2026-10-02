import type { Categoria, TipoGasto } from '../modelo';
import { normalizarTexto } from './texto';
import type { Decision, MovimientoPropuesto } from './importar';

/**
 * Revisión con IA por copiar y pegar, para uso doméstico.
 * La app nunca se conecta a ninguna IA: genera un texto anonimizado que tú copias en un chat,
 * y valida la respuesta que pegas antes de usarla. Dos revisiones independientes (redacción y orden
 * distintos, en chats nuevos) y solo se acepta lo que coincide.
 */

export type Rango = 'menos de 10 €' | 'entre 10 y 50 €' | 'entre 50 y 200 €' | 'más de 200 €';
export type Seguridad = 'alta' | 'media' | 'baja';

export interface ItemIA {
  /** Número en la lista (1..n), estable entre las dos peticiones. */
  n: number;
  comercio: string;
  veces: number;
  rango: Rango;
  sentido: 'gasto' | 'entrada';
  /** Movimientos de la importación a los que se aplica. No se incluye en el texto. */
  ids: string[];
}

export interface PropuestaIA {
  categoriaId: string;
  tipo: TipoGasto;
  seguridad: Seguridad;
  motivo: string;
}

export interface RespuestaLeida {
  propuestas: Map<number, PropuestaIA>;
  errores: string[];
}

function rango(centimos: number): Rango {
  const e = Math.abs(centimos) / 100;
  if (e < 10) return 'menos de 10 €';
  if (e <= 50) return 'entre 10 y 50 €';
  if (e <= 200) return 'entre 50 y 200 €';
  return 'más de 200 €';
}

/**
 * Gastos dudosos agrupados por comercio. Nunca incluye Bizum ni transferencias a personas
 * (solo tú sabes para qué fueron), ni importes exactos, fechas, cuentas o nombres.
 */
export function itemsDudosos(movs: readonly MovimientoPropuesto[], decisiones: ReadonlyMap<string, Decision>, dudoso: (m: MovimientoPropuesto) => boolean): ItemIA[] {
  const grupos = new Map<string, { comercio: string; ids: string[]; importes: number[] }>();
  for (const m of movs) {
    const d = decisiones.get(m.id);
    if (!d?.incluir || d.destino !== 'gasto' || m.duplicado || !dudoso(m) || m.propuesta.limpio.persona) continue;
    const comercio = m.propuesta.limpio.comercio.trim();
    if (!comercio) continue;
    const clave = m.propuesta.limpio.clave || normalizarTexto(comercio);
    const g = grupos.get(clave) ?? { comercio, ids: [], importes: [] };
    g.ids.push(m.id);
    g.importes.push(m.importe);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map((g, i) => {
    const media = g.importes.reduce((s, x) => s + Math.abs(x), 0) / g.importes.length;
    return { n: i + 1, comercio: g.comercio, veces: g.ids.length, rango: rango(media), sentido: g.importes.every((x) => x > 0) ? 'entrada' : 'gasto', ids: g.ids };
  });
}

function barajar<T>(lista: readonly T[], semilla: number): T[] {
  // Orden distinto pero reproducible (no aleatorio): la segunda petición siempre igual para la misma lista.
  const out = [...lista];
  let s = semilla;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export const MARCA_RESPUESTA = 'RESPUESTA-FINANZAS';

const EXCLUIDAS_IA = new Set(['personas', 'efectivo', 'impuestos']);

/**
 * Petición para pegar en un chat de IA. Variante 1 y 2: distinta redacción y orden, mismos números.
 */
export function crearPeticion(items: readonly ItemIA[], categorias: readonly Categoria[], variante: 1 | 2): string {
  // Sin "Personas", "Efectivo" ni "Impuestos": no se deducen del nombre de un comercio y no se le ofrecen a la IA.
  const nombres = categorias.filter((c) => !c.archivada && !EXCLUIDAS_IA.has(c.clave ?? '')).map((c) => c.nombre);
  const lista = (variante === 1 ? items : barajar(items, items.length * 7919 + 17))
    .map((it) => `${it.n}. ${it.comercio} · ${it.veces} ${it.veces === 1 ? 'vez' : 'veces'} · ${it.rango}${it.sentido === 'entrada' ? ' · devolución o abono' : ''}`)
    .join('\n');
  const intro =
    variante === 1
      ? 'Ayúdame a clasificar gastos de mis finanzas personales (uso doméstico, España, vivo en Ibiza). Son nombres de comercio tal como aparecen en el banco.'
      : 'Revisión independiente: clasifica estos cargos bancarios de una persona en España (Ibiza). No supongas nada que no se deduzca del nombre del comercio.';
  return `${intro}

Para cada número, elige UNA categoría de esta lista, escrita exactamente igual:
${nombres.map((n) => `- ${n}`).join('\n')}

Indica también el tipo (Fijo si es una cuota o recibo que se repite cada mes, Variable si no, Extra si es algo puntual y grande) y tu seguridad (alta, media o baja). Si no puedes saberlo por el nombre, pon seguridad "baja" y categoría "Otros". No inventes.

Comercios:
${lista}

Responde SOLO con este bloque, sin nada más:
${MARCA_RESPUESTA}
[{"n": 1, "categoria": "…", "tipo": "Variable", "seguridad": "alta", "motivo": "…"}]`;
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Extrae y valida la respuesta pegada. Nunca aplica nada a medias: lo inválido se descarta y se informa. */
export function leerRespuesta(texto: string, items: readonly ItemIA[], categorias: readonly Categoria[]): RespuestaLeida {
  const errores: string[] = [];
  const propuestas = new Map<number, PropuestaIA>();
  const inicio = texto.indexOf('[', Math.max(0, texto.indexOf(MARCA_RESPUESTA)));
  const fin = texto.lastIndexOf(']');
  if (inicio < 0) return { propuestas, errores: [`No encuentro la lista de respuestas. Pega el bloque completo que empieza por ${MARCA_RESPUESTA}.`] };
  if (fin < inicio) return { propuestas, errores: ['La respuesta está incompleta o mal copiada (falta el final). Cópiala entera otra vez.'] };
  let json: unknown;
  try {
    json = JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return { propuestas, errores: ['La respuesta está incompleta o mal copiada (no es una lista válida). Cópiala entera otra vez.'] };
  }
  if (!Array.isArray(json)) return { propuestas, errores: ['La respuesta no es una lista.'] };

  const porNombre = new Map(categorias.filter((c) => !c.archivada && !EXCLUIDAS_IA.has(c.clave ?? '')).map((c) => [normalizarTexto(c.nombre), c.id]));
  const numeros = new Set(items.map((i) => i.n));
  for (const fila of json as unknown[]) {
    if (!esObjeto(fila)) {
      errores.push('Hay una fila que no tiene el formato esperado.');
      continue;
    }
    const n = fila['n'];
    if (typeof n !== 'number' || !numeros.has(n)) {
      errores.push(`Número ${String(n)} no está en la lista: se ignora.`);
      continue;
    }
    if (propuestas.has(n)) {
      errores.push(`El número ${n} aparece dos veces: se ignora la repetición.`);
      continue;
    }
    const categoria = typeof fila['categoria'] === 'string' ? porNombre.get(normalizarTexto(fila['categoria'])) : undefined;
    if (!categoria) {
      errores.push(`Número ${n}: la categoría «${String(fila['categoria'])}» no existe en tu lista.`);
      continue;
    }
    const tipo = fila['tipo'];
    const seguridad = fila['seguridad'];
    propuestas.set(n, {
      categoriaId: categoria,
      tipo: tipo === 'Fijo' || tipo === 'Extra' ? tipo : 'Variable',
      seguridad: seguridad === 'alta' || seguridad === 'media' ? seguridad : 'baja',
      motivo: typeof fila['motivo'] === 'string' ? fila['motivo'].slice(0, 120) : '',
    });
  }
  const faltan = items.filter((i) => !propuestas.has(i.n)).map((i) => i.n);
  if (faltan.length > 0) errores.push(`Sin respuesta válida para: ${faltan.join(', ')}. Esos siguen pendientes de tu revisión.`);
  return { propuestas, errores };
}

export type EstadoConsenso = 'coinciden' | 'una-revision' | 'discrepan' | 'baja-seguridad' | 'contradice-diccionario';

export interface Consenso {
  n: number;
  estado: EstadoConsenso;
  /** Solo se propone categoría cuando hay acuerdo suficiente. */
  categoriaId: string | null;
  tipo: TipoGasto;
  explicacion: string;
}

/**
 * Combina las dos revisiones y la opinión de la app:
 *  - coinciden: misma categoría en las dos, ninguna con seguridad baja, y no contradice al diccionario.
 *  - una-revision: solo hay una respuesta (se propone, pero se avisa).
 *  - discrepan / baja-seguridad / contradice-diccionario: no se propone nada; decides tú.
 */
export function consenso(
  items: readonly ItemIA[],
  r1: ReadonlyMap<number, PropuestaIA>,
  r2: ReadonlyMap<number, PropuestaIA> | null,
  opinionApp: (item: ItemIA) => { categoriaId: string | null; segura: boolean },
  nombre: (id: string) => string,
): Consenso[] {
  return items.map((it) => {
    const a = r1.get(it.n);
    const b = r2?.get(it.n);
    const app = opinionApp(it);
    const base = { n: it.n, tipo: a?.tipo ?? 'Variable' };
    if (!a && !b) return { ...base, estado: 'baja-seguridad', categoriaId: null, explicacion: 'La IA no respondió a este comercio.' };
    const unica = a ?? b;
    if (unica && (!a || !b || r2 === null)) {
      if (unica.seguridad === 'baja') return { ...base, estado: 'baja-seguridad', categoriaId: null, explicacion: 'La IA no está segura.' };
      if (app.segura && app.categoriaId && app.categoriaId !== unica.categoriaId) {
        return { ...base, estado: 'contradice-diccionario', categoriaId: null, explicacion: `La IA dice ${nombre(unica.categoriaId)} y la app ${nombre(app.categoriaId)}.` };
      }
      return { ...base, tipo: unica.tipo, estado: 'una-revision', categoriaId: unica.categoriaId, explicacion: `Una sola revisión: ${nombre(unica.categoriaId)}. Haz la segunda para más seguridad.` };
    }
    if (!a || !b) throw new Error('inalcanzable');
    if (a.categoriaId !== b.categoriaId) {
      return { ...base, estado: 'discrepan', categoriaId: null, explicacion: `Las dos revisiones no coinciden: ${nombre(a.categoriaId)} / ${nombre(b.categoriaId)}.` };
    }
    if (a.seguridad === 'baja' || b.seguridad === 'baja') {
      return { ...base, estado: 'baja-seguridad', categoriaId: null, explicacion: `Coinciden en ${nombre(a.categoriaId)}, pero con poca seguridad.` };
    }
    if (app.segura && app.categoriaId && app.categoriaId !== a.categoriaId) {
      return { ...base, estado: 'contradice-diccionario', categoriaId: null, explicacion: `La IA dice ${nombre(a.categoriaId)} y la app ${nombre(app.categoriaId)}.` };
    }
    return { ...base, tipo: a.tipo === b.tipo ? a.tipo : 'Variable', estado: 'coinciden', categoriaId: a.categoriaId, explicacion: `Las dos revisiones coinciden: ${nombre(a.categoriaId)}.` };
  });
}
