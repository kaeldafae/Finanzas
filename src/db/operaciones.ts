import type { Centimos } from '../domain/dinero';
import { fraccionar6040 } from '../domain/irpf';
import {
  AJUSTES_LOCALES,
  compararPeriodos,
  idMes,
  sumarMeses,
  type Ajustes,
  type Categoria,
  type Compromiso,
  type Gasto,
  type Ingreso,
  type IngresoExtra,
  type MesRegistro,
  type Importacion,
  type MetaSync,
  type ObjetivoAhorro,
  type Pagador,
  type Periodo,
  type Presupuesto,
  type Regla,
  type Traspaso,
} from '../domain/modelo';
import { crearCopia, type CopiaSeguridad } from '../domain/copia';
import type { DatosFinancieros } from '../domain/resumen';
import { TABLAS_SYNC, type Instantanea } from '../domain/sync';
import { claveSuelta } from '../domain/importacion/huella';
import { emparejarNomina, type DatosNomina } from '../domain/importacion/nomina';
import { db, marcaTiempo, notificarCambio, nuevoId, normalizarAjustes, sellar, tablasDatos, type BaseDatos } from './db';

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
  const [pagadores, categorias, ingresos, extras, gastos, meses, reglas, traspasos, presupuestos, importaciones, compromisos, objetivos] = await Promise.all([
    base.pagadores.filter(vivo).toArray(),
    base.categorias.orderBy('orden').filter(vivo).toArray(),
    base.ingresos.filter(vivo).toArray(),
    base.extras.filter(vivo).toArray(),
    base.gastos.filter(vivo).toArray(),
    base.meses.filter(vivo).toArray(),
    base.reglas.filter(vivo).toArray(),
    base.traspasos.filter(vivo).toArray(),
    base.presupuestos.filter(vivo).toArray(),
    base.importaciones.orderBy('fecha').reverse().filter(vivo).toArray(),
    base.compromisos.filter(vivo).toArray(),
    base.objetivos.filter(vivo).toArray(),
  ]);
  return { pagadores, categorias, ingresos, extras, gastos, meses, reglas, traspasos, presupuestos, importaciones, compromisos, objetivos };
}

export async function leerAjustes(base: BaseDatos = db): Promise<Ajustes> {
  return normalizarAjustes(await base.ajustes.get('ajustes'));
}

/** Todo, incluidas las marcas de borrado: es lo que se sincroniza. */
export async function leerInstantanea(base: BaseDatos = db): Promise<Instantanea> {
  const [pagadores, categorias, ingresos, extras, gastos, meses, reglas, traspasos, presupuestos, importaciones, compromisos, objetivos, ajustes] = await Promise.all([
    base.pagadores.toArray(),
    base.categorias.toArray(),
    base.ingresos.toArray(),
    base.extras.toArray(),
    base.gastos.toArray(),
    base.meses.toArray(),
    base.reglas.toArray(),
    base.traspasos.toArray(),
    base.presupuestos.toArray(),
    base.importaciones.toArray(),
    base.compromisos.toArray(),
    base.objetivos.toArray(),
    leerAjustes(base),
  ]);
  return { pagadores, categorias, ingresos, extras, gastos, meses, reglas, traspasos, presupuestos, importaciones, compromisos, objetivos, ajustes };
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
      // Ni huella, fecha ni cuenta: la copia es una previsión, no el movimiento del banco del mes anterior.
      fijos.map(({ origen: _o, huella: _h, fecha: _f, cuenta: _c, ...g }) => sellar({ ...g, id: nuevoId(), anio: p.anio, mes: p.mes })),
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
  return base.transaction('r', tablasDatos(base), async () => {
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
  await base.transaction('rw', tablasDatos(base), async () => {
    const marca = marcaTiempo();
    for (const t of TABLAS_SYNC) {
      await base.table<MetaSync & { id: string }, string>(t).toCollection().modify((f) => {
        if (!f.borrado) {
          f.borrado = true;
          f.actualizadoEl = marca;
        }
      });
    }
    for (const filas of [d.pagadores, d.categorias, d.ingresos, d.extras, d.gastos, d.meses, d.reglas, d.traspasos, d.presupuestos, d.importaciones, d.compromisos, d.objetivos]) {
      if (idsRepetidos(filas)) throw new Error('La copia tiene identificadores repetidos.');
    }
    await base.pagadores.bulkPut(d.pagadores.map(sellar));
    await base.categorias.bulkPut(d.categorias.map(sellar));
    await base.ingresos.bulkPut(d.ingresos.map(sellar));
    await base.extras.bulkPut(d.extras.map(sellar));
    await base.gastos.bulkPut(d.gastos.map(sellar));
    await base.meses.bulkPut(d.meses.map(sellar));
    await base.reglas.bulkPut(d.reglas.map(sellar));
    await base.traspasos.bulkPut(d.traspasos.map(sellar));
    await base.presupuestos.bulkPut(d.presupuestos.map(sellar));
    await base.importaciones.bulkPut(d.importaciones.map(sellar));
    await base.compromisos.bulkPut(d.compromisos.map(sellar));
    await base.objetivos.bulkPut(d.objetivos.map(sellar));
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

// --- Importación de extractos -----------------------------------------------------------------

/** Huellas ya importadas, incluidas las de movimientos que borraste (para que no vuelvan). */
export async function huellasImportadas(base: BaseDatos = db): Promise<Set<string>> {
  const [g, i, e, t] = await Promise.all([base.gastos.toArray(), base.ingresos.toArray(), base.extras.toArray(), base.traspasos.toArray()]);
  const s = new Set<string>();
  for (const f of [...g, ...i, ...e]) if (f.huella) s.add(f.huella);
  for (const f of t) s.add(f.id);
  return s;
}

/**
 * Movimientos importados que siguen en la app, contados por cuenta, día e importe con signo.
 * Permite reconocer lo ya importado aunque llegue en otro formato (PDF frente a CSV).
 */
export async function clavesImportadas(base: BaseDatos = db): Promise<Map<string, number>> {
  const [g, i, e, t] = await Promise.all([base.gastos.toArray(), base.ingresos.toArray(), base.extras.toArray(), base.traspasos.toArray()]);
  // Cada movimiento importado con su importe con signo, tal como venía del banco.
  const movs = new Map<string, { cuenta: string | undefined; fecha: string | undefined; importe: number }>();
  for (const x of g) if (vivo(x) && x.huella) movs.set(x.huella, { cuenta: x.cuenta, fecha: x.fecha, importe: x.devolucion ? x.importe : -x.importe });
  for (const x of i) if (vivo(x) && x.huella) movs.set(x.huella, { cuenta: x.cuenta, fecha: x.fecha, importe: x.neto });
  for (const x of e) if (vivo(x) && x.huella) movs.set(x.huella, { cuenta: x.cuenta, fecha: x.fecha, importe: x.importe });
  for (const x of t) if (vivo(x)) movs.set(x.id, { cuenta: x.cuenta, fecha: x.fecha, importe: x.importe });

  const m = new Map<string, number>();
  const sumar = (cuenta: string | undefined, fecha: string | undefined, importe: number) => {
    if (!cuenta || !fecha) return;
    const k = claveSuelta(cuenta, fecha, importe);
    m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const [huella, x] of movs) {
    if (!huella.endsWith('-comision')) {
      sumar(x.cuenta, x.fecha, x.importe);
      continue;
    }
    // Las comisiones separadas no cuentan solas, pero su movimiento también se reconoce por el total
    // con comisión (así lo muestra el PDF de Revolut).
    const padre = movs.get(huella.slice(0, -'-comision'.length));
    if (padre) sumar(padre.cuenta, padre.fecha, padre.importe + x.importe);
  }
  return m;
}

export async function reglasAprendidas(base: BaseDatos = db): Promise<Map<string, { categoriaId: string; tipo: Gasto['tipo'] }>> {
  const reglas = await base.reglas.filter(vivo).toArray();
  return new Map(reglas.map((r) => [r.id, { categoriaId: r.categoriaId, tipo: r.tipo }]));
}

export interface FilasAImportar {
  importacion: Importacion;
  gastos: Gasto[];
  ingresos: Ingreso[];
  extras: IngresoExtra[];
  traspasos: Traspaso[];
  reglas: Regla[];
  meses: Periodo[];
}

/**
 * Guarda una importación en una sola transacción: o entra todo o nada.
 * Vuelve a comprobar las huellas dentro de la transacción por si otra pestaña importó lo mismo.
 */
export async function aplicarImportacion(f: FilasAImportar, base: BaseDatos = db): Promise<{ guardados: number }> {
  let guardados = 0;
  await base.transaction('rw', [base.gastos, base.ingresos, base.extras, base.traspasos, base.reglas, base.meses, base.importaciones], async () => {
    const existentes = await huellasImportadas(base);
    const nuevo = (x: { huella?: string }) => !x.huella || !existentes.has(x.huella);
    const id = f.importacion.id;
    const gastos = f.gastos.filter(nuevo).map((x) => sellar({ ...x, importacion: id }));
    const ingresos = f.ingresos.filter(nuevo).map((x) => sellar({ ...x, importacion: id }));
    const extras = f.extras.filter(nuevo).map((x) => sellar({ ...x, importacion: id }));
    const traspasos = f.traspasos.filter((t) => !existentes.has(t.id)).map((x) => sellar({ ...x, importacion: id }));
    await base.gastos.bulkAdd(gastos);
    await base.ingresos.bulkAdd(ingresos);
    await base.extras.bulkAdd(extras);
    await base.traspasos.bulkAdd(traspasos);
    await base.reglas.bulkPut(f.reglas.map(sellar));
    for (const p of f.meses) await base.meses.put(sellar<MesRegistro>({ id: idMes(p.anio, p.mes), anio: p.anio, mes: p.mes, confirmado: true }));
    guardados = gastos.length + ingresos.length + extras.length + traspasos.length;
    if (guardados > 0) await base.importaciones.put(sellar({ ...f.importacion, movimientos: guardados }));
  });
  notificarCambio();
  return { guardados };
}

/**
 * Deshace una importación entera: marca como borrado todo lo que creó (también en los demás
 * dispositivos, vía sincronización) y libera sus huellas para poder volver a importar el extracto.
 * Las reglas aprendidas y los meses confirmados se conservan.
 */
export async function deshacerImportacion(id: string, base: BaseDatos = db): Promise<number> {
  let n = 0;
  await base.transaction('rw', [base.gastos, base.ingresos, base.extras, base.traspasos, base.importaciones], async () => {
    const marca = marcaTiempo();
    const anular = (f: MetaSync & { importacion?: string; huella?: string }) => {
      if (f.importacion !== id || f.borrado) return;
      f.borrado = true;
      f.actualizadoEl = marca;
      // Sin huella, el mismo movimiento se puede volver a importar.
      delete f.huella;
      n++;
    };
    await base.gastos.toCollection().modify(anular);
    await base.ingresos.toCollection().modify(anular);
    await base.extras.toCollection().modify(anular);
    // Los traspasos usan la huella como id: se borran del todo para liberarla.
    const traspasos = await base.traspasos.filter((t) => t.importacion === id).toArray();
    await base.traspasos.bulkDelete(traspasos.map((t) => t.id));
    n += traspasos.filter((t) => !t.borrado).length;
    const reg = await base.importaciones.get(id);
    if (reg) await base.importaciones.put(sellar({ ...reg, deshecha: true }));
  });
  notificarCambio();
  return n;
}

export async function guardarPresupuestos(lista: ReadonlyArray<{ categoriaId: string; importe: Centimos }>, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.presupuestos, async () => {
    for (const p of lista) {
      if (p.importe > 0) await base.presupuestos.put(sellar<Presupuesto>({ id: p.categoriaId, importe: p.importe }));
      else await marcarBorrado<Presupuesto>(base.presupuestos, p.categoriaId);
    }
  });
  notificarCambio();
}

export async function borrarRegla(id: string, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.reglas, () => marcarBorrado<Regla>(base.reglas, id));
  notificarCambio();
}

// --- Nóminas --------------------------------------------------------------------------------

export interface ResultadoNomina {
  accion: 'completada' | 'creada';
  ingresoId: string;
}

/**
 * Completa con la nómina el ingreso que llegó del banco (mismo neto, ese mes o el siguiente) o, si no
 * existe, crea el ingreso. El neto del banco no se toca: es el dato verificado.
 */
export async function aplicarNomina(n: DatosNomina, periodo: Periodo, pagadorId: string, base: BaseDatos = db): Promise<ResultadoNomina> {
  const r = await base.transaction('rw', base.ingresos, async () => {
    const ingresos = await base.ingresos.toArray();
    const par = emparejarNomina(n, periodo, ingresos);
    const cotizacion = { bruto: n.bruto, seguridadSocial: n.seguridadSocial, retencionIRPF: n.irpf };
    const netoManual = n.bruto - n.seguridadSocial - n.irpf !== n.neto;
    if (par) {
      const { pendienteNomina: _p, ...resto } = par;
      await base.ingresos.put(sellar({ ...resto, ...cotizacion, netoManual, nota: par.nota || 'Completado con la nómina' }));
      return { accion: 'completada' as const, ingresoId: par.id };
    }
    const id = nuevoId();
    await base.ingresos.add(
      sellar<Ingreso>({ id, anio: periodo.anio, mes: periodo.mes, pagadorId, ...cotizacion, neto: n.neto, netoManual, estado: 'Real', nota: 'Desde la nómina (PDF)' }),
    );
    return { accion: 'creada' as const, ingresoId: id };
  });
  notificarCambio();
  return r;
}

// --- Pagos recurrentes y objetivos ------------------------------------------------------------

export async function guardarCompromiso(c: Omit<Compromiso, 'id'> & { id?: string }, base: BaseDatos = db): Promise<void> {
  await base.compromisos.put(sellar({ ...c, id: c.id ?? nuevoId() }));
  notificarCambio();
}

export async function borrarCompromiso(id: string, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.compromisos, () => marcarBorrado<Compromiso>(base.compromisos, id));
  notificarCambio();
}

export async function guardarObjetivo(o: Omit<ObjetivoAhorro, 'id'> & { id?: string }, base: BaseDatos = db): Promise<void> {
  await base.objetivos.put(sellar({ ...o, id: o.id ?? nuevoId() }));
  notificarCambio();
}

/** Suma (o resta, si es negativa) una aportación a lo ya apartado. Nunca baja de 0. */
export async function aportarObjetivo(id: string, importe: Centimos, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.objetivos, async () => {
    const o = await base.objetivos.get(id);
    if (o && !o.borrado) await base.objetivos.put(sellar({ ...o, importeActual: Math.max(0, o.importeActual + importe) }));
  });
  notificarCambio();
}

export async function borrarObjetivo(id: string, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.objetivos, () => marcarBorrado<ObjetivoAhorro>(base.objetivos, id));
  notificarCambio();
}
