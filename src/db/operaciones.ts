import type { Centimos } from '../domain/dinero';
import { fraccionar6040 } from '../domain/irpf';
import {
  compararPeriodos,
  idMes,
  sumarMeses,
  type Ajustes,
  type Categoria,
  type Gasto,
  type Ingreso,
  type IngresoExtra,
  type Pagador,
  type Periodo,
} from '../domain/modelo';
import { crearCopia, type CopiaSeguridad } from '../domain/copia';
import type { DatosFinancieros } from '../domain/resumen';
import { db, nuevoId, normalizarAjustes, type BaseDatos } from './db';

// --- Lectura -----------------------------------------------------------------------------

export async function leerTodo(base: BaseDatos = db): Promise<DatosFinancieros> {
  const [pagadores, categorias, ingresos, extras, gastos, meses] = await Promise.all([
    base.pagadores.toArray(),
    base.categorias.orderBy('orden').toArray(),
    base.ingresos.toArray(),
    base.extras.toArray(),
    base.gastos.toArray(),
    base.meses.toArray(),
  ]);
  return { pagadores, categorias, ingresos, extras, gastos, meses };
}

export async function leerAjustes(base: BaseDatos = db): Promise<Ajustes> {
  return normalizarAjustes(await base.ajustes.get('ajustes'));
}

export async function guardarAjustes(cambios: Partial<Omit<Ajustes, 'id'>>, base: BaseDatos = db): Promise<void> {
  await base.transaction('rw', base.ajustes, async () => {
    const actual = await leerAjustes(base);
    await base.ajustes.put({ ...actual, ...cambios, id: 'ajustes' });
  });
}

// --- Movimientos ---------------------------------------------------------------------------

export async function guardarIngreso(i: Omit<Ingreso, 'id'> & { id?: string }): Promise<void> {
  await db.ingresos.put({ ...i, id: i.id ?? nuevoId() });
}

/** Crea copias en Previsto del ingreso en los meses siguientes hasta `hasta` (incluido). */
export async function repetirIngreso(base: Omit<Ingreso, 'id'>, hasta: Periodo): Promise<number> {
  const copias: Ingreso[] = [];
  for (let p = sumarMeses(base, 1); compararPeriodos(p, hasta) <= 0 && copias.length < 24; p = sumarMeses(p, 1)) {
    copias.push({ ...base, id: nuevoId(), anio: p.anio, mes: p.mes, estado: 'Previsto' });
  }
  await db.ingresos.bulkAdd(copias);
  return copias.length;
}

export async function borrarIngreso(id: string): Promise<void> {
  await db.ingresos.delete(id);
}

export async function marcarIngresoReal(id: string): Promise<void> {
  await db.ingresos.update(id, { estado: 'Real' });
}

export async function guardarExtra(e: Omit<IngresoExtra, 'id'> & { id?: string }): Promise<void> {
  await db.extras.put({ ...e, id: e.id ?? nuevoId() });
}

export async function borrarExtra(id: string): Promise<void> {
  await db.extras.delete(id);
}

export async function guardarGasto(g: Omit<Gasto, 'id'> & { id?: string }): Promise<void> {
  await db.gastos.put({ ...g, id: g.id ?? nuevoId() });
}

export async function borrarGasto(id: string): Promise<void> {
  await db.gastos.delete(id);
}

export async function confirmarMes(p: Periodo, confirmado: boolean): Promise<void> {
  const id = idMes(p.anio, p.mes);
  if (confirmado) await db.meses.put({ id, anio: p.anio, mes: p.mes, confirmado: true });
  else await db.meses.delete(id);
}

/** Copia los gastos fijos del mes anterior. Devuelve cuántos se han copiado. */
export async function copiarFijosMesAnterior(p: Periodo): Promise<number> {
  const anterior = sumarMeses(p, -1);
  return db.transaction('rw', db.gastos, async () => {
    const fijos = await db.gastos.where('[anio+mes]').equals([anterior.anio, anterior.mes]).filter((g) => g.tipo === 'Fijo').toArray();
    const yaHay = await db.gastos.where('[anio+mes]').equals([p.anio, p.mes]).filter((g) => g.tipo === 'Fijo').count();
    if (yaHay > 0) return 0;
    await db.gastos.bulkAdd(
      // Sin `origen`: la copia es un gasto normal aunque el original viniera de la renta.
      fijos.map(({ origen: _origen, ...g }) => ({ ...g, id: nuevoId(), anio: p.anio, mes: p.mes })),
    );
    return fijos.length;
  });
}

async function categoriaImpuestos(): Promise<string> {
  const existente = (await db.categorias.toArray()).find((c) => c.clave === 'impuestos');
  if (existente) {
    if (existente.archivada) await db.categorias.update(existente.id, { archivada: false });
    return existente.id;
  }
  const id = nuevoId();
  await db.categorias.add({ id, nombre: 'Impuestos', orden: await db.categorias.count(), clave: 'impuestos', archivada: false });
  return id;
}

/**
 * Crea (o sustituye) el gasto "Renta" del ejercicio en junio del año siguiente, o 60 % junio / 40 % noviembre.
 */
export async function crearGastoRenta(ejercicio: number, importe: Centimos, fraccionado: boolean): Promise<void> {
  const origen = `renta-${ejercicio}`;
  await db.transaction('rw', db.gastos, db.categorias, async () => {
    const categoriaId = await categoriaImpuestos();
    await db.gastos.where('origen').equals(origen).delete();
    const base = { anio: ejercicio + 1, categoriaId, tipo: 'Extra' as const, origen };
    if (fraccionado) {
      const { junio, noviembre } = fraccionar6040(importe);
      await db.gastos.bulkAdd([
        { ...base, id: nuevoId(), mes: 6, importe: junio, nota: `Renta ${ejercicio} · 1.er plazo (60 %)` },
        { ...base, id: nuevoId(), mes: 11, importe: noviembre, nota: `Renta ${ejercicio} · 2.º plazo (40 %)` },
      ]);
    } else {
      await db.gastos.add({ ...base, id: nuevoId(), mes: 6, importe, nota: `Renta ${ejercicio}` });
    }
  });
}

export async function gastosRentaExistentes(ejercicio: number): Promise<number> {
  return db.gastos.where('origen').equals(`renta-${ejercicio}`).count();
}

// --- Pagadores y categorías -----------------------------------------------------------------

export async function guardarPagador(p: Omit<Pagador, 'id'> & { id?: string }): Promise<void> {
  await db.pagadores.put({ ...p, id: p.id ?? nuevoId() });
}

/** Si el pagador tiene ingresos se archiva (para no romper el histórico); si no, se borra. */
export async function eliminarPagador(id: string): Promise<'borrado' | 'archivado'> {
  return db.transaction('rw', db.pagadores, db.ingresos, async () => {
    const usos = await db.ingresos.where('pagadorId').equals(id).count();
    if (usos > 0) {
      await db.pagadores.update(id, { archivado: true });
      return 'archivado';
    }
    await db.pagadores.delete(id);
    return 'borrado';
  });
}

export async function guardarCategoria(c: Omit<Categoria, 'id' | 'orden'> & { id?: string; orden?: number }): Promise<void> {
  const orden = c.orden ?? (await db.categorias.count());
  await db.categorias.put({ ...c, orden, id: c.id ?? nuevoId() });
}

export async function eliminarCategoria(id: string): Promise<'borrado' | 'archivado'> {
  return db.transaction('rw', db.categorias, db.gastos, async () => {
    const usos = await db.gastos.where('categoriaId').equals(id).count();
    const cat = await db.categorias.get(id);
    if (usos > 0 || cat?.clave) {
      await db.categorias.update(id, { archivada: true });
      return 'archivado';
    }
    await db.categorias.delete(id);
    return 'borrado';
  });
}

export async function moverCategoria(id: string, direccion: -1 | 1): Promise<void> {
  await db.transaction('rw', db.categorias, async () => {
    const lista = await db.categorias.orderBy('orden').toArray();
    const i = lista.findIndex((c) => c.id === id);
    const j = i + direccion;
    const a = lista[i];
    const b = lista[j];
    if (!a || !b) return;
    lista[i] = b;
    lista[j] = a;
    await db.categorias.bulkPut(lista.map((c, orden) => ({ ...c, orden })));
  });
}

// --- Copias de seguridad -------------------------------------------------------------------

export async function exportarCopia(base: BaseDatos = db, ahora = new Date()): Promise<CopiaSeguridad> {
  return base.transaction('r', [base.pagadores, base.categorias, base.ingresos, base.extras, base.gastos, base.meses, base.ajustes], async () => {
    const [datos, ajustes] = await Promise.all([leerTodo(base), leerAjustes(base)]);
    return crearCopia(datos, ajustes, ahora);
  });
}

/**
 * Sustituye todos los datos por los de la copia en una única transacción:
 * si algo falla, Dexie revierte y los datos anteriores quedan intactos.
 */
export async function importarCopia(copia: CopiaSeguridad, base: BaseDatos = db): Promise<void> {
  const tablas = [base.pagadores, base.categorias, base.ingresos, base.extras, base.gastos, base.meses, base.ajustes];
  await base.transaction('rw', tablas, async () => {
    await Promise.all(tablas.map((t) => t.clear()));
    const d = copia.datos;
    await base.pagadores.bulkAdd(d.pagadores);
    await base.categorias.bulkAdd(d.categorias);
    await base.ingresos.bulkAdd(d.ingresos);
    await base.extras.bulkAdd(d.extras);
    await base.gastos.bulkAdd(d.gastos);
    await base.meses.bulkAdd(d.meses);
    await base.ajustes.put(normalizarAjustes(d.ajustes));
  });
}

export async function borrarTodo(base: BaseDatos = db): Promise<void> {
  await base.delete();
  await base.open();
}
