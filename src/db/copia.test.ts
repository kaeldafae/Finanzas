import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { euros } from '../domain/dinero';
import { leerCopia, validarCopia } from '../domain/copia';
import { BaseDatos } from './db';
import { exportarCopia, importarCopia, leerTodo } from './operaciones';

let base: BaseDatos;
let n = 0;

beforeEach(async () => {
  base = new BaseDatos(`test-${n++}`);
  await base.open();
  const pagador = await base.pagadores.toArray();
  const pagadorId = pagador[0]?.id ?? '';
  await base.ingresos.add({
    id: 'i1', anio: 2026, mes: 3, pagadorId, bruto: euros(1050), seguridadSocial: euros(45),
    retencionIRPF: 0, neto: euros(1005), netoManual: false, estado: 'Real', nota: '',
  });
});

afterEach(async () => {
  await base.delete();
});

describe('copias de seguridad', () => {
  it('la base nueva trae categorías, pagadores y ajustes por defecto', async () => {
    const d = await leerTodo(base);
    expect(d.categorias.length).toBeGreaterThanOrEqual(13);
    expect(d.categorias.some((c) => c.clave === 'alquiler')).toBe(true);
    expect(d.pagadores.map((p) => p.tipo).sort()).toEqual(['Empresa', 'SEPE']);
  });

  it('exportar → validar → importar conserva los datos', async () => {
    const copia = await exportarCopia(base);
    const texto = JSON.stringify(copia);
    const leida = leerCopia(texto);
    expect(leida.ok).toBe(true);
    if (!leida.ok) return;
    await base.ingresos.clear();
    await importarCopia(leida.copia, base);
    expect(await base.ingresos.count()).toBe(1);
  });

  it('JSON corrupto: error claro y los datos no se tocan', async () => {
    const r = leerCopia('{"app":"finanzas-personales", "datos": [');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]).toMatch(/JSON válido/);
    expect(await base.ingresos.count()).toBe(1);
  });

  it('JSON de otra app o con esquema incorrecto se rechaza con detalle', async () => {
    expect(validarCopia({ foo: 1 }).ok).toBe(false);
    const copia = await exportarCopia(base);
    const mala = structuredClone(copia) as unknown as { datos: { ingresos: Array<Record<string, unknown>> } };
    const fila = mala.datos.ingresos[0];
    if (fila) {
      fila['bruto'] = -5;
      fila['mes'] = 13;
      fila['pagadorId'] = 'no-existe';
    }
    const r = validarCopia(mala);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores.join('\n')).toMatch(/bruto/);
      expect(r.errores.join('\n')).toMatch(/mes/);
      expect(r.errores.join('\n')).toMatch(/pagador no existe/);
    }
    expect(await base.ingresos.count()).toBe(1);
  });

  it('copias de una versión futura del esquema se rechazan', async () => {
    const copia = { ...(await exportarCopia(base)), schemaVersion: 99 };
    const r = validarCopia(copia);
    expect(r.ok).toBe(false);
  });

  it('si la importación falla a mitad, la transacción revierte y no se pierde nada', async () => {
    const copia = await exportarCopia(base);
    // Dos ingresos con el mismo id: bulkAdd falla dentro de la transacción.
    const ingreso = copia.datos.ingresos[0];
    if (!ingreso) throw new Error('falta ingreso');
    const rota = { ...copia, datos: { ...copia.datos, ingresos: [ingreso, { ...ingreso }] } };
    await expect(importarCopia(rota, base)).rejects.toThrow();
    expect(await base.ingresos.count()).toBe(1);
    expect(await base.categorias.count()).toBeGreaterThan(0);
  });
});
