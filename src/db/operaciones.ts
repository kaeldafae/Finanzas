import type { Centimos } from '../domain/dinero';
import { fraccionar6040 } from '../domain/irpf';
import {
  AJUSTES_LOCALES,
  compararPeriodos,
  idMes,
  sumarMeses,
  type Ajustes,
  type Categoria,
  type Gasto,
  type Ingreso,
  type IngresoExtra,
  type MesRegistro,
  type MetaSync,
  type Pagador,
  type Periodo,
} from '../domain/modelo';
import { crearCopia, type CopiaSeguridad } from '../domain/copia';
import type { DatosFinancieros } from '../domain/resumen';
import { TABLAS_SYNC, type Instantanea } from '../domain/sync';
import { db, marcaTiempo, notificarCambio, nuevoId, normalizarAjustes, sellar, type BaseDatos } from './db';

/*
 * Reglas de escritura (necesarias para la sincronización):
 *  - Toda escritura local pasa por `sellar`, que fecha la fila.
 *  - Nada se borra de verdad: se marca `borrado: true` (y se fecha).
 *  - Toda lectura para la interfaz ignora las filas borradas.
 *  - Tras escribir se llama a `notificarCambio` para programar la sincronización.
 */

const vivo = (f: MetaSync) => !f.borrado;

/** Lo mínimo que necesitan los ayudantes de una tabla de Dexie. */
interface TablaSimple<T> {
  get(id: string): PromiseLike<T | undefined>;
  put(fila: T): PromiseLike<unknown>;
}

// --- Lectura -----------------------------------------------------------------------------

export async function leerTodo(base: BaseDatos = db): Promise<DatosFinancieros> {
  const [pagadores, categorias, ingresos, extras, gastos, meses] = await Promise.all([
    base.pagadores.filter(vivo).toArray(),
    base.categorias.orderBy('orden').filter(vivo).toArray(),
    base.ingresos.filter(vivo).toArray(),
    base.extras.filter(vivo).toArray(),
    base.gastos.filter(vivo).toArray(),
    base.meses.filter(vivo).toArray(),
  ]);
  return { pagadores, categorias, ingresos, extras, gastos, meses };
}

export async function leerAjustes(base: BaseDatos = db): Promise<Ajustes> {
  return normalizarAjustes(await base.ajustes.get('ajustes'));
}

/** Todo, incluidas las marcas de borrado: es lo que se sincroniza. */
export async function leerInstantanea(base: BaseDatos = db): Promise<Instantanea> {
  const [pagadores, categorias, ingresos, extras, gastos, meses, ajustes] = await Promise.all([
    base.pagadores.toArray(),
    base.categorias.toArray(),
    base.ingresos.toArray(),
    base.extras.toArray(),
    base.gastos.toArray(),
    base.meses.toArray(),
    leerAjustes(base),
  ]);
  return { pagadores, categorias, ingresos, extras, gastos, meses, ajustes };
}

/**
 * Solo se fecha si cambia algo sincronizable: cambiar el tema en el móvil
 * no debe hacer que sus ajustes ganen a los del ordenador.
 */
export async function guardarAjustes(cambios: Partial<Omit<Ajustes, 'id'>>, base: BaseDatos = db): Promise<void> {
  const soloLocales = Object.keys(cambios).every((k) => (AJUSTES_LOCALES as readonly string[]).includes(k));
  await base.transaction('rw', base.ajustes, async () => {
    const actual = await leerAjustes(base);
    const nuevo: Ajustes = { ...actual, ...cambios, id: 'ajustes' };
    await base.ajustes.put(soloLocales ? nuevo : { ...nuevo, actualizadoEl: marcaTiempo() });
  });
  if (!soloLocales) notificarCambio();
}

// --- Utilidades internas -------------------------------------------------------------------

async function marcarBorrado<T extends MetaSync & { id: string }>(tabla: TablaSimple<T>, id: string): Promise<void> {
  const fila = await tabla.get(id);
  if (fila && !fila.borrado) await tabla.put({ ...fila, borrado: true, actualizadoEl: marcaTiempo() });
}

async function modificar<T extends MetaSync & { id: string }>(tabla: TablaSimple<T>, id: string, cambios: Partial<T>): Promise<void> {
  const fila = await tabla.get(id);
  if (fila && !fila.borrado) await tabla.put(sellar({ ...fila, ...cambios }));
}

// --- Movimientos ---------------------------------------------------------------------------

export async function guardarIngreso(i: Omit<Ingreso, 'id'> & { id?: string }, base: BaseDatos = db): Promise<void> {
  await base.ingresos.put(sellar({ ...i, id: i.id ?? nuevoId() }));
  notificarCambio();
}

/** Crea copias en Previsto del ingreso en los meses siguientes hasta `hasta` (incluido). */
export async function repetirIngreso(origen: Omit<Ingreso, 'id'>, hasta: Periodo, base: BaseDatos = db): Promise<number> {
  const copias: Ingreso[] = [];
  for (let p = sumarMeses(origen, 1); compararPeriodos(p, hasta) <= 0 && copias.length < 24; p = sumarMeses(p, 1)) {
    copias.push(sellar({ ...origen, id: nuevoId(), anio: p.anio, mes: p.mes, estado: 'Previsto' }));
  }
  await base.ingresos.bulkAdd(copias);
  notificarCambio();
  return copias.length;
}

export async function borrarIngreso(id: string, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.ingresos, () => marcarBorrado<Ingreso>(base.ingresos, id));
  notificarCambio();
}

export async function marcarIngresoReal(id: string, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.ingresos, () => modificar<Ingreso>(base.ingresos, id, { estado: 'Real' }));
  notificarCambio();
}

export async function guardarExtra(e: Omit<IngresoExtra, 'id'> & { id?: string }, base: BaseDatos = db): Promise<void> {
  await base.extras.put(sellar({ ...e, id: e.id ?? nuevoId() }));
  notificarCambio();
}

export async function borrarExtra(id: string, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.extras, () => marcarBorrado<IngresoExtra>(base.extras, id));
  notificarCambio();
}

export async function guardarGasto(g: Omit<Gasto, 'id'> & { id?: string }, base: BaseDatos = db): Promise<void> {
  await base.gastos.put(sellar({ ...g, id: g.id ?? nuevoId() }));
  notificarCambio();
}

export async function borrarGasto(id: string, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.gastos, () => marcarBorrado<Gasto>(base.gastos, id));
  notificarCambio();
}

export async function confirmarMes(p: Periodo, confirmado: boolean, base: BaseDatos = db): Promise<void> {
  const id = idMes(p.anio, p.mes);
  await base.transaction('rw', base.meses, async () => {
    if (confirmado) await base.meses.put(sellar<MesRegistro>({ id, anio: p.anio, mes: p.mes, confirmado: true }));
    else await marcarBorrado<MesRegistro>(base.meses, id);
  });
  notificarCambio();
}

/** Copia los gastos fijos del mes anterior. Devuelve cuántos se han copiado. */
export async function copiarFijosMesAnterior(p: Periodo, base: BaseDatos = db): Promise<number> {
  const anterior = sumarMeses(p, -1);
  const n = await base.transaction('rw', base.gastos, async () => {
    const fijos = await base.gastos
      .where('[anio+mes]')
      .equals([anterior.anio, anterior.mes])
      .filter((g) => vivo(g) && g.tipo === 'Fijo')
      .toArray();
    const yaHay = await base.gastos
      .where('[anio+mes]')
      .equals([p.anio, p.mes])
      .filter((g) => vivo(g) && g.tipo === 'Fijo')
      .count();
    if (yaHay > 0) return 0;
    await base.gastos.bulkAdd(
      // Sin `origen`: la copia es un gasto normal aunque el original viniera de la renta.
      fijos.map(({ origen: _origen, ...g }) => sellar({ ...g, id: nuevoId(), anio: p.anio, mes: p.mes })),
    );
    return fijos.length;
  });
  if (n > 0) notificarCambio();
  return n;
}

async function categoriaImpuestos(base: BaseDatos): Promise<string> {
  const existente = (await base.categorias.filter(vivo).toArray()).find((c) => c.clave === 'impuestos');
  if (existente) {
    if (existente.archivada) await base.categorias.put(sellar({ ...existente, archivada: false }));
    return existente.id;
  }
  const id = nuevoId();
  const orden = await base.categorias.filter(vivo).count();
  await base.categorias.add(sellar<Categoria>({ id, nombre: 'Impuestos', orden, clave: 'impuestos', archivada: false }));
  return id;
}

/**
 * Crea (o sustituye) el gasto "Renta" del ejercicio en junio del año siguiente, o 60 % junio / 40 % noviembre.
 */
export async function crearGastoRenta(ejercicio: number, importe: Centimos, fraccionado: boolean, base: BaseDatos = db): Promise<void> {
  const origen = `renta-${ejercicio}`;
  await base.transaction('rw', base.gastos, base.categorias, async () => {
    const categoriaId = await categoriaImpuestos(base);
    const anteriores = await base.gastos.where('origen').equals(origen).filter(vivo).toArray();
    for (const g of anteriores) await marcarBorrado<Gasto>(base.gastos, g.id);
    const comun = { anio: ejercicio + 1, categoriaId, tipo: 'Extra' as const, origen };
    if (fraccionado) {
      const { junio, noviembre } = fraccionar6040(importe);
      await base.gastos.bulkAdd([
        sellar<Gasto>({ ...comun, id: nuevoId(), mes: 6, importe: junio, nota: `Renta ${ejercicio} · 1.er plazo (60 %)` }),
        sellar<Gasto>({ ...comun, id: nuevoId(), mes: 11, importe: noviembre, nota: `Renta ${ejercicio} · 2.º plazo (40 %)` }),
      ]);
    } else {
      await base.gastos.add(sellar<Gasto>({ ...comun, id: nuevoId(), mes: 6, importe, nota: `Renta ${ejercicio}` }));
    }
  });
  notificarCambio();
}

export async function gastosRentaExistentes(ejercicio: number, base: BaseDatos = db): Promise<number> {
  return base.gastos.where('origen').equals(`renta-${ejercicio}`).filter(vivo).count();
}

// --- Pagadores y categorías -----------------------------------------------------------------

export async function guardarPagador(p: Omit<Pagador, 'id'> & { id?: string }, base: BaseDatos = db): Promise<void> {
  await base.pagadores.put(sellar({ ...p, id: p.id ?? nuevoId() }));
  notificarCambio();
}

/** Si el pagador tiene ingresos se archiva (para no romper el histórico); si no, se borra. */
export async function eliminarPagador(id: string, base: BaseDatos = db): Promise<'borrado' | 'archivado'> {
  const r = await base.transaction('rw', base.pagadores, base.ingresos, async () => {
    const usos = await base.ingresos.where('pagadorId').equals(id).filter(vivo).count();
    if (usos > 0) {
      await modificar<Pagador>(base.pagadores, id, { archivado: true });
      return 'archivado' as const;
    }
    await marcarBorrado<Pagador>(base.pagadores, id);
    return 'borrado' as const;
  });
  notificarCambio();
  return r;
}

export async function guardarCategoria(c: Omit<Categoria, 'id' | 'orden'> & { id?: string; orden?: number }, base: BaseDatos = db): Promise<void> {
  const orden = c.orden ?? (await base.categorias.filter(vivo).count());
  await base.categorias.put(sellar({ ...c, orden, id: c.id ?? nuevoId() }));
  notificarCambio();
}

export async function eliminarCategoria(id: string, base: BaseDatos = db): Promise<'borrado' | 'archivado'> {
  const r = await base.transaction('rw', base.categorias, base.gastos, async () => {
    const usos = await base.gastos.where('categoriaId').equals(id).filter(vivo).count();
    const cat = await base.categorias.get(id);
    if (usos > 0 || cat?.clave) {
      await modificar<Categoria>(base.categorias, id, { archivada: true });
      return 'archivado' as const;
    }
    await marcarBorrado<Categoria>(base.categorias, id);
    return 'borrado' as const;
  });
  notificarCambio();
  return r;
}

export async function moverCategoria(id: string, direccion: -1 | 1, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.categorias, async () => {
    const lista = await base.categorias.orderBy('orden').filter(vivo).toArray();
    const i = lista.findIndex((c) => c.id === id);
    const j = i + direccion;
    const a = lista[i];
    const b = lista[j];
    if (!a || !b) return;
    lista[i] = b;
    lista[j] = a;
    // Solo se fechan las que cambian de posición.
    await base.categorias.bulkPut(lista.flatMap((c, orden) => (c.orden === orden ? [] : [sellar({ ...c, orden })])));
  });
  notificarCambio();
}

// --- Copias de seguridad -------------------------------------------------------------------

export async function exportarCopia(base: BaseDatos = db, ahora = new Date()): Promise<CopiaSeguridad> {
  return base.transaction('r', [base.pagadores, base.categorias, base.ingresos, base.extras, base.gastos, base.meses, base.ajustes], async () => {
    const [datos, ajustes] = await Promise.all([leerTodo(base), leerAjustes(base)]);
    return crearCopia(datos, ajustes, ahora);
  });
}

function idsRepetidos(filas: ReadonlyArray<{ id: string }>): boolean {
  return new Set(filas.map((f) => f.id)).size !== filas.length;
}

/**
 * Sustituye todos los datos por los de la copia en una única transacción:
 * si algo falla, Dexie revierte y los datos anteriores quedan intactos.
 *
 * No vacía las tablas: marca como borrado lo que había y escribe la copia fechada ahora.
 * Así, con la sincronización activa, la sustitución llega también a los demás dispositivos.
 */
export async function importarCopia(copia: CopiaSeguridad, base: BaseDatos = db): Promise<void> {
  const d = copia.datos;
  await base.transaction('rw', [base.pagadores, base.categorias, base.ingresos, base.extras, base.gastos, base.meses, base.ajustes], async () => {
    const marca = marcaTiempo();
    for (const t of TABLAS_SYNC) {
      await base.table<MetaSync & { id: string }, string>(t).toCollection().modify((f) => {
        if (!f.borrado) {
          f.borrado = true;
          f.actualizadoEl = marca;
        }
      });
    }
    for (const filas of [d.pagadores, d.categorias, d.ingresos, d.extras, d.gastos, d.meses]) {
      if (idsRepetidos(filas)) throw new Error('La copia tiene identificadores repetidos.');
    }
    await base.pagadores.bulkPut(d.pagadores.map(sellar));
    await base.categorias.bulkPut(d.categorias.map(sellar));
    await base.ingresos.bulkPut(d.ingresos.map(sellar));
    await base.extras.bulkPut(d.extras.map(sellar));
    await base.gastos.bulkPut(d.gastos.map(sellar));
    await base.meses.bulkPut(d.meses.map(sellar));
    const actuales = await leerAjustes(base);
    await base.ajustes.put({
      ...normalizarAjustes(d.ajustes),
      tema: actuales.tema,
      ultimaCopia: actuales.ultimaCopia,
      actualizadoEl: marcaTiempo(),
    });
  });
  notificarCambio();
}

/** Borra los datos de ESTE dispositivo, incluida la conexión de sincronización. */
export async function borrarTodo(base: BaseDatos = db): Promise<void> {
  await base.delete();
  await base.open();
}
