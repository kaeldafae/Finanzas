import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { BaseDatos } from './db';
import { leerTodo } from './operaciones';

describe('migración de la base de datos v1 → v2 (sincronización)', () => {
  it('conserva los datos de una instalación anterior y los fecha para la primera fusión', async () => {
    const nombre = 'migracion-v1';
    // Esquema exacto de la versión 1 publicada.
    const v1 = new Dexie(nombre);
    v1.version(1).stores({
      pagadores: 'id, tipo',
      categorias: 'id, orden',
      ingresos: 'id, [anio+mes], anio, pagadorId',
      extras: 'id, [anio+mes], anio',
      gastos: 'id, [anio+mes], anio, categoriaId, origen',
      meses: 'id, anio',
      ajustes: 'id',
    });
    await v1.open();
    await v1.table('pagadores').add({ id: 'p-aleatorio', nombre: 'SEPE', tipo: 'SEPE', archivado: false });
    await v1.table('ingresos').add({ id: 'i1', anio: 2026, mes: 9, pagadorId: 'p-aleatorio', bruto: 105000, seguridadSocial: 4500, retencionIRPF: 0, neto: 100500, netoManual: false, estado: 'Real', nota: '' });
    v1.close();

    const v2 = new BaseDatos(nombre);
    await v2.open();
    const d = await leerTodo(v2);
    expect(d.ingresos).toHaveLength(1);
    expect(d.ingresos[0]?.actualizadoEl).toBeGreaterThan(0);
    expect(d.pagadores[0]?.actualizadoEl).toBeGreaterThan(0);
    expect(await v2.config.count()).toBe(0);
    await v2.delete();
  });
});

describe('migración v2 → v3 (importador)', () => {
  it('reconoce las categorías existentes por nombre, añade las nuevas sin duplicar y conserva los datos', async () => {
    const nombre = 'migracion-v2';
    const v2 = new Dexie(nombre);
    v2.version(1).stores({ pagadores: 'id, tipo', categorias: 'id, orden', ingresos: 'id, [anio+mes], anio, pagadorId', extras: 'id, [anio+mes], anio', gastos: 'id, [anio+mes], anio, categoriaId, origen', meses: 'id, anio', ajustes: 'id' });
    v2.version(2).stores({ config: 'id' });
    await v2.open();
    await v2.table('categorias').bulkAdd([
      { id: 'c-aleatoria-1', nombre: 'Comida', orden: 0, archivada: false, actualizadoEl: 5 },
      { id: 'c-aleatoria-2', nombre: 'Alquiler', orden: 1, clave: 'alquiler', archivada: false, actualizadoEl: 5 },
      { id: 'c-propia', nombre: 'Gimnasio', orden: 2, archivada: false, actualizadoEl: 5 },
    ]);
    await v2.table('gastos').add({ id: 'g1', anio: 2026, mes: 3, categoriaId: 'c-aleatoria-1', importe: 1000, tipo: 'Variable', nota: '', actualizadoEl: 5 });
    v2.close();

    const v3 = new BaseDatos(nombre);
    await v3.open();
    const d = await leerTodo(v3);
    expect(d.gastos).toHaveLength(1);
    expect(d.categorias.find((c) => c.id === 'c-aleatoria-1')?.clave).toBe('comida');
    expect(d.categorias.find((c) => c.id === 'c-propia')?.clave).toBeUndefined();
    expect(d.categorias.filter((c) => c.clave === 'comida')).toHaveLength(1);
    expect(d.categorias.filter((c) => c.clave === 'alquiler')).toHaveLength(1);
    expect(d.categorias.some((c) => c.clave === 'restaurantes')).toBe(true);
    expect(d.reglas).toEqual([]);
    await v3.delete();
  });
});

describe('aplicar importación', () => {
  it('guarda todo en una transacción y no duplica al repetir', async () => {
    const { aplicarImportacion, huellasImportadas } = await import('./operaciones');
    const b = new BaseDatos('aplicar-imp');
    await b.open();
    const filas = {
      gastos: [{ id: 'g', anio: 2026, mes: 3, categoriaId: 'cat-comida', importe: 4530, tipo: 'Variable' as const, nota: 'Mercadona', huella: 'h1', fecha: '2026-03-02', cuenta: 'Revolut' }],
      ingresos: [],
      extras: [],
      traspasos: [{ id: 'h2', anio: 2026, mes: 3, fecha: '2026-03-01', cuenta: 'Revolut', importe: 60000, tipo: 'interno' as const }],
      reglas: [{ id: 'mercadona', categoriaId: 'cat-comida', tipo: 'Variable' as const }],
      meses: [{ anio: 2026, mes: 3 }],
    };
    expect((await aplicarImportacion(filas, b)).guardados).toBe(2);
    expect((await aplicarImportacion({ ...filas, gastos: filas.gastos.map((g) => ({ ...g, id: 'otro' })) }, b)).guardados).toBe(0);
    expect(await huellasImportadas(b)).toEqual(new Set(['h1', 'h2']));
    expect((await leerTodo(b)).meses).toHaveLength(1);
    await b.delete();
  });
});
