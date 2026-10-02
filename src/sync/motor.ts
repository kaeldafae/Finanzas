import { cifrar, descifrar, leerSobre } from '../domain/cifrado';
import { crearCopia, validarCopia } from '../domain/copia';
import {
  filasAEscribir,
  fusionar,
  idsAEliminar,
  purgarBorrados,
  sonIguales,
  TABLAS_SYNC,
  unificarCatalogos,
  type Instantanea,
} from '../domain/sync';
import { marcaTiempo, type BaseDatos } from '../db/db';
import { leerInstantanea } from '../db/operaciones';
import type { ClienteRemoto } from './remoto';

export class ErrorSync extends Error {
  constructor(
    mensaje: string,
    readonly motivo: 'clave-cambiada' | 'formato' | 'conflictos',
  ) {
    super(mensaje);
    this.name = 'ErrorSync';
  }
}

export interface ContextoSync {
  base: BaseDatos;
  cliente: ClienteRemoto;
  clave: CryptoKey;
  sal: string;
  iteraciones: number;
  /** Primera sincronización de este dispositivo: se unifican categorías y pagadores por nombre. */
  primeraVez: boolean;
  ahora?: () => number;
}

export interface ResultadoSync {
  /** Filas locales escritas con datos que llegaron de otro dispositivo. */
  recibidos: number;
  /** Si se ha subido una versión nueva. */
  enviado: boolean;
}

const MAX_INTENTOS = 5;

async function descifrarRemota(texto: string, ctx: ContextoSync): Promise<Instantanea> {
  const sobre = leerSobre(texto);
  if (sobre.kdf.sal !== ctx.sal || sobre.kdf.iteraciones !== ctx.iteraciones) {
    throw new ErrorSync('La contraseña de cifrado se ha cambiado desde otro dispositivo. Vuelve a escribirla.', 'clave-cambiada');
  }
  const plano = await descifrar(ctx.clave, sobre);
  let json: unknown;
  try {
    json = JSON.parse(plano);
  } catch {
    throw new ErrorSync('Los datos sincronizados están dañados.', 'formato');
  }
  const r = validarCopia(json, { referencias: false });
  if (!r.ok) throw new ErrorSync(`Los datos sincronizados no son válidos: ${r.errores[0] ?? ''}`, 'formato');
  return r.copia.datos;
}

/** Aplica en local la fusión, en una única transacción. Devuelve cuántas filas ha escrito. */
async function aplicarEnLocal(base: BaseDatos, remota: Instantanea | null, primeraVez: boolean, ahora: number): Promise<Instantanea> {
  return base.transaction('rw', [base.pagadores, base.categorias, base.ingresos, base.extras, base.gastos, base.meses, base.reglas, base.traspasos, base.presupuestos, base.importaciones, base.ajustes], async () => {
    const original = await leerInstantanea(base);
    const local = primeraVez && remota ? unificarCatalogos(original, remota, marcaTiempo()) : original;
    const fusion = purgarBorrados(remota ? fusionar(local, remota) : local, ahora);

    for (const t of TABLAS_SYNC) {
      // Las tablas tienen tipos distintos; aquí solo importan id y metadatos.
      const tabla = base.table<{ id: string }, string>(t);
      const escribir = filasAEscribir<{ id: string }>(fusion[t], original[t]);
      const eliminar = idsAEliminar(fusion[t], original[t]);
      if (escribir.length > 0) await tabla.bulkPut(escribir);
      if (eliminar.length > 0) await tabla.bulkDelete(eliminar);
    }
    if (JSON.stringify(fusion.ajustes) !== JSON.stringify(original.ajustes)) await base.ajustes.put(fusion.ajustes);
    return fusion;
  });
}

function contarRecibidos(antes: Instantanea, despues: Instantanea): number {
  let n = 0;
  for (const t of TABLAS_SYNC) n += filasAEscribir<{ id: string }>(despues[t], antes[t]).length;
  return n;
}

/** Lo que se sube: sin preferencias del dispositivo. */
function paraSubir(f: Instantanea, ahora: number): string {
  const { ajustes, ...datos } = f;
  return JSON.stringify(crearCopia(datos, { ...ajustes, tema: 'auto', ultimaCopia: null }, new Date(ahora)));
}

/**
 * Descarga, descifra, fusiona, aplica en local y sube la versión fusionada cifrada.
 * Si otro dispositivo sube a la vez, GitHub rechaza la escritura y se repite el ciclo.
 */
export async function sincronizar(ctx: ContextoSync): Promise<ResultadoSync> {
  const ahora = ctx.ahora ?? Date.now;
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    const archivo = await ctx.cliente.leer();
    const remota = archivo ? await descifrarRemota(archivo.texto, ctx) : null;

    const antes = await leerInstantanea(ctx.base);
    const fusion = await aplicarEnLocal(ctx.base, remota, ctx.primeraVez, ahora());
    const recibidos = contarRecibidos(antes, fusion);

    if (remota && sonIguales(fusion, remota)) return { recibidos, enviado: false };

    const sobre = await cifrar(ctx.clave, paraSubir(fusion, ahora()), { sal: ctx.sal, iteraciones: ctx.iteraciones }, new Date(ahora()));
    const r = await ctx.cliente.escribir(JSON.stringify(sobre), archivo?.sha ?? null);
    if (r.ok) return { recibidos, enviado: true };
    // Conflicto: otro dispositivo ha subido entre medias. Se vuelve a leer y fusionar.
  }
  throw new ErrorSync('Demasiados cambios simultáneos desde otros dispositivos. Se reintentará en un momento.', 'conflictos');
}

export interface ClaveCifrado {
  clave: CryptoKey;
  sal: string;
  iteraciones: number;
}

/**
 * Cambia la contraseña sin conocer la anterior: este dispositivo ya tiene la clave antigua,
 * así que descifra lo que hay en GitHub y lo vuelve a cifrar con la clave nueva.
 * Antes se sincroniza para que la versión re-cifrada incluya los últimos cambios de todos.
 * Si otro dispositivo sube entre medias, se repite (la escritura usa control por sha).
 */
export async function recifrar(base: BaseDatos, cliente: ClienteRemoto, antigua: ClaveCifrado, nueva: ClaveCifrado, ahora: () => number = Date.now): Promise<void> {
  const ctx: ContextoSync = { base, cliente, ...antigua, primeraVez: false, ahora };
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    await sincronizar(ctx);
    const archivo = await cliente.leer();
    if (!archivo) return;
    const sobre = leerSobre(archivo.texto);
    if (sobre.kdf.sal !== antigua.sal) {
      throw new ErrorSync('La contraseña ya se ha cambiado desde otro dispositivo. Escribe la nueva para seguir.', 'clave-cambiada');
    }
    const plano = await descifrar(antigua.clave, sobre);
    const nuevoSobre = await cifrar(nueva.clave, plano, { sal: nueva.sal, iteraciones: nueva.iteraciones }, new Date(ahora()));
    const r = await cliente.escribir(JSON.stringify(nuevoSobre), archivo.sha);
    if (r.ok) return;
  }
  throw new ErrorSync('Demasiados cambios simultáneos desde otros dispositivos. Inténtalo de nuevo.', 'conflictos');
}

/**
 * Último recurso si ningún dispositivo recuerda la contraseña: sustituye lo que hay en GitHub
 * por los datos de ESTE dispositivo, cifrados con la clave nueva. Lo que estuviera solo en GitHub se pierde.
 */
export async function sobrescribirRemoto(base: BaseDatos, cliente: ClienteRemoto, nueva: ClaveCifrado, ahora: () => number = Date.now): Promise<void> {
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    const archivo = await cliente.leer();
    const local = await leerInstantanea(base);
    const sobre = await cifrar(nueva.clave, paraSubir(local, ahora()), { sal: nueva.sal, iteraciones: nueva.iteraciones }, new Date(ahora()));
    const r = await cliente.escribir(JSON.stringify(sobre), archivo?.sha ?? null);
    if (r.ok) return;
  }
  throw new ErrorSync('No se ha podido sustituir el archivo de GitHub por cambios simultáneos. Inténtalo de nuevo.', 'conflictos');
}
