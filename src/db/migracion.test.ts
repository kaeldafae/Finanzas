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
