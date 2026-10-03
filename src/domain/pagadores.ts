import type { Pagador, TipoPagador } from './modelo';

/**
 * Varias empresas: elegir el pagador de un ingreso a partir del texto del banco o de la nómina.
 * Gana el pagador con más palabras de su nombre en el texto (o su NIF/CIF). Si hay empate, no se adivina.
 */

const VACIAS = new Set(['sl', 'sa', 'slu', 'sau', 'sociedad', 'limitada', 'anonima', 'grupo', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'cb', 'scp']);

function norm(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

const normNif = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');

function palabras(nombre: string): string[] {
  return norm(nombre).split(' ').filter((w) => w.length >= 3 && !VACIAS.has(w));
}

export function pagadorPorTexto(texto: string, pagadores: readonly Pagador[], tipo: TipoPagador | null, nif?: string | null): string | null {
  const candidatos = pagadores.filter((p) => !p.archivado && (!tipo || p.tipo === tipo));
  if (candidatos.length === 1) return candidatos[0]?.id ?? null;
  const limpio = normNif(nif ?? '');
  if (limpio) {
    const porNif = candidatos.find((p) => p.nif && normNif(p.nif) === limpio);
    if (porNif) return porNif.id;
  }
  const t = ` ${norm(texto)} `;
  let mejor: { id: string; puntos: number } | null = null;
  let empate = false;
  for (const p of candidatos) {
    const puntos = palabras(p.nombre).filter((w) => t.includes(` ${w} `)).length;
    if (puntos === 0) continue;
    if (!mejor || puntos > mejor.puntos) {
      mejor = { id: p.id, puntos };
      empate = false;
    } else if (puntos === mejor.puntos) empate = true;
  }
  return mejor && !empate ? mejor.id : null;
}
