import { AJUSTES_LOCALES, type Ajustes, type MetaSync } from './modelo';
import type { DatosFinancieros } from './resumen';

/**
 * Fusión de datos entre dispositivos. Funciones puras: sin red, sin IndexedDB.
 *
 * Regla: por cada registro (mismo id) gana el de `actualizadoEl` más reciente.
 * Un borrado es un registro más (con `borrado: true`), así que un borrado reciente
 * gana a una edición antigua y viceversa. En empate se elige de forma determinista,
 * para que todos los dispositivos lleguen al mismo resultado sin coordinarse.
 */

export type TablaSync = 'pagadores' | 'categorias' | 'ingresos' | 'extras' | 'gastos' | 'meses' | 'reglas' | 'traspasos' | 'presupuestos' | 'importaciones';
export const TABLAS_SYNC: readonly TablaSync[] = ['pagadores', 'categorias', 'ingresos', 'extras', 'gastos', 'meses', 'reglas', 'traspasos', 'presupuestos', 'importaciones'];

export type Instantanea = DatosFinancieros & { ajustes: Ajustes };

/** Días que se conservan las marcas de borrado antes de eliminarlas del todo. */
export const DIAS_CONSERVAR_BORRADOS = 90;

interface ConId extends MetaSync {
  id: string;
}

/** Comparación estable: mismo resultado en cualquier dispositivo y en cualquier orden de argumentos. */
function gana(a: ConId, b: ConId): boolean {
  const ta = a.actualizadoEl ?? 0;
  const tb = b.actualizadoEl ?? 0;
  if (ta !== tb) return ta > tb;
  // Empate: el borrado gana (más conservador); después, comparación del contenido serializado.
  if (Boolean(a.borrado) !== Boolean(b.borrado)) return Boolean(a.borrado);
  return JSON.stringify(a) >= JSON.stringify(b);
}

export function fusionarFilas<T extends ConId>(locales: readonly T[], remotas: readonly T[]): T[] {
  const mapa = new Map<string, T>();
  for (const f of locales) mapa.set(f.id, f);
  for (const r of remotas) {
    const l = mapa.get(r.id);
    if (!l || !gana(l, r)) mapa.set(r.id, r);
  }
  return [...mapa.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Solo los campos sincronizables de Ajustes deciden; tema y última copia son de cada dispositivo. */
function ajustesSincronizables(a: Ajustes): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...a };
  for (const k of AJUSTES_LOCALES) Reflect.deleteProperty(copia, k);
  return copia;
}

export function fusionarAjustes(local: Ajustes, remoto: Ajustes): Ajustes {
  const tl = local.actualizadoEl ?? 0;
  const tr = remoto.actualizadoEl ?? 0;
  let ganador = local;
  if (tr > tl) ganador = remoto;
  else if (tr === tl && JSON.stringify(ajustesSincronizables(remoto)) > JSON.stringify(ajustesSincronizables(local))) ganador = remoto;
  // Las preferencias del dispositivo nunca viajan.
  return { ...ganador, tema: local.tema, ultimaCopia: local.ultimaCopia };
}

export function fusionar(local: Instantanea, remota: Instantanea): Instantanea {
  return {
    pagadores: fusionarFilas(local.pagadores, remota.pagadores),
    categorias: fusionarFilas(local.categorias, remota.categorias),
    ingresos: fusionarFilas(local.ingresos, remota.ingresos),
    extras: fusionarFilas(local.extras, remota.extras),
    gastos: fusionarFilas(local.gastos, remota.gastos),
    meses: fusionarFilas(local.meses, remota.meses),
    reglas: fusionarFilas(local.reglas, remota.reglas),
    traspasos: fusionarFilas(local.traspasos, remota.traspasos),
    presupuestos: fusionarFilas(local.presupuestos, remota.presupuestos),
    importaciones: fusionarFilas(local.importaciones, remota.importaciones),
    ajustes: fusionarAjustes(local.ajustes, remota.ajustes),
  };
}

/** Elimina marcas de borrado antiguas: a esas alturas todos los dispositivos ya las han recibido. */
export function purgarBorrados(d: Instantanea, ahora: number, dias = DIAS_CONSERVAR_BORRADOS): Instantanea {
  const limite = ahora - dias * 86_400_000;
  const vivo = (f: MetaSync) => !f.borrado || (f.actualizadoEl ?? 0) >= limite;
  return {
    pagadores: d.pagadores.filter(vivo),
    categorias: d.categorias.filter(vivo),
    ingresos: d.ingresos.filter(vivo),
    extras: d.extras.filter(vivo),
    gastos: d.gastos.filter(vivo),
    meses: d.meses.filter(vivo),
    reglas: d.reglas.filter(vivo),
    traspasos: d.traspasos.filter(vivo),
    presupuestos: d.presupuestos.filter(vivo),
    importaciones: d.importaciones.filter(vivo),
    ajustes: d.ajustes,
  };
}

/** ¿Hay alguna diferencia de contenido sincronizable entre dos instantáneas? */
export function sonIguales(a: Instantanea, b: Instantanea): boolean {
  for (const t of TABLAS_SYNC) {
    const fa: readonly ConId[] = a[t];
    const fb: readonly ConId[] = b[t];
    if (fa.length !== fb.length) return false;
    const mapa = new Map(fb.map((f) => [f.id, JSON.stringify(f)]));
    for (const f of fa) if (mapa.get(f.id) !== JSON.stringify(f)) return false;
  }
  return JSON.stringify(ajustesSincronizables(a.ajustes)) === JSON.stringify(ajustesSincronizables(b.ajustes))
    && (a.ajustes.actualizadoEl ?? 0) === (b.ajustes.actualizadoEl ?? 0);
}

/** Filas de `fusion` que hay que escribir en local porque ganan a lo que hay. */
export function filasAEscribir<T extends ConId>(fusion: readonly T[], locales: readonly T[]): T[] {
  const mapa = new Map(locales.map((f) => [f.id, JSON.stringify(f)]));
  return fusion.filter((f) => mapa.get(f.id) !== JSON.stringify(f));
}

/** Ids locales que la purga ha eliminado de la fusión. */
export function idsAEliminar(fusion: readonly ConId[], locales: readonly ConId[]): string[] {
  const vivos = new Set(fusion.map((f) => f.id));
  return locales.filter((f) => !vivos.has(f.id)).map((f) => f.id);
}

function normalizarNombre(n: string): string {
  return n.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * Al conectar un dispositivo que ya tenía datos a una sincronización existente, sus categorías y
 * pagadores pueden ser los mismos que los remotos con otro id (p. ej., los creados por defecto).
 * Se unifican por nombre (y tipo o clave): los movimientos locales pasan a apuntar al id remoto y
 * el duplicado local se marca como borrado. Solo se usa en la primera sincronización del dispositivo.
 */
export function unificarCatalogos(local: Instantanea, remota: Instantanea, marca: number): Instantanea {
  const idsRemotosPag = new Set(remota.pagadores.map((p) => p.id));
  const idsRemotosCat = new Set(remota.categorias.map((c) => c.id));
  const mapaPag = new Map<string, string>();
  const mapaCat = new Map<string, string>();

  for (const p of local.pagadores) {
    if (p.borrado || idsRemotosPag.has(p.id)) continue;
    const igual = remota.pagadores.find((r) => !r.borrado && r.tipo === p.tipo && normalizarNombre(r.nombre) === normalizarNombre(p.nombre));
    if (igual) mapaPag.set(p.id, igual.id);
  }
  for (const c of local.categorias) {
    if (c.borrado || idsRemotosCat.has(c.id)) continue;
    const igual = remota.categorias.find(
      (r) => !r.borrado && ((c.clave !== undefined && r.clave === c.clave) || normalizarNombre(r.nombre) === normalizarNombre(c.nombre)),
    );
    if (igual) mapaCat.set(c.id, igual.id);
  }
  if (mapaPag.size === 0 && mapaCat.size === 0) return local;

  return {
    ...local,
    pagadores: local.pagadores.map((p) => (mapaPag.has(p.id) ? { ...p, borrado: true, actualizadoEl: marca } : p)),
    categorias: local.categorias.map((c) => (mapaCat.has(c.id) ? { ...c, borrado: true, actualizadoEl: marca } : c)),
    ingresos: local.ingresos.map((i) => {
      const nuevo = mapaPag.get(i.pagadorId);
      return nuevo ? { ...i, pagadorId: nuevo, actualizadoEl: marca } : i;
    }),
    gastos: local.gastos.map((g) => {
      const nuevo = mapaCat.get(g.categoriaId);
      return nuevo ? { ...g, categoriaId: nuevo, actualizadoEl: marca } : g;
    }),
  };
}
