import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claveSuelta } from '../domain/importacion/huella';
import { BaseDatos } from './db';
import { aplicarNomina, aportarObjetivo, clavesImportadas, guardarObjetivo } from './operaciones';

let base: BaseDatos;
let n = 0;

beforeEach(async () => {
  base = new BaseDatos(`claves-${n++}`);
  await base.open();
});

afterEach(async () => {
  await base.delete();
});

describe('movimientos ya importados por cuenta, día e importe', () => {
  it('cuenta gastos, devoluciones y traspasos, y reconoce el total con comisión', async () => {
    const comun = { anio: 2026, mes: 3, categoriaId: 'cat-efectivo', tipo: 'Variable' as const, nota: '', cuenta: 'Revolut', fecha: '2026-03-08' };
    await base.gastos.bulkAdd([
      { ...comun, id: 'g1', importe: 5000, huella: 'h1' },
      { ...comun, id: 'g2', importe: 100, huella: 'h1-comision' },
      { ...comun, id: 'g3', importe: 530, huella: 'h2', devolucion: true },
      // Apuntado a mano: no cuenta.
      { ...comun, id: 'g4', importe: 999 },
      // Borrado (deshacer importación): no cuenta.
      { ...comun, id: 'g5', importe: 777, huella: 'h5', borrado: true },
    ]);
    await base.traspasos.add({ id: 'h3', anio: 2026, mes: 3, fecha: '2026-03-01', cuenta: 'Revolut', importe: 60000, tipo: 'interno' });

    const m = await clavesImportadas(base);
    expect(m.get(claveSuelta('Revolut', '2026-03-08', -5000))).toBe(1);
    expect(m.get(claveSuelta('Revolut', '2026-03-08', -5100))).toBe(1);
    expect(m.get(claveSuelta('Revolut', '2026-03-08', 530))).toBe(1);
    expect(m.get(claveSuelta('Revolut', '2026-03-01', 60000))).toBe(1);
    expect(m.get(claveSuelta('Revolut', '2026-03-08', -100))).toBeUndefined();
    expect(m.get(claveSuelta('Revolut', '2026-03-08', -999))).toBeUndefined();
    expect(m.get(claveSuelta('Revolut', '2026-03-08', -777))).toBeUndefined();
  });
});

describe('nómina aplicada al ingreso del banco', () => {
  const nomina = { bruto: 185000, seguridadSocial: 12005, irpf: 22100, otrasDeducciones: 0, neto: 150895, periodo: { anio: 2026, mes: 5 }, avisos: [] };

  it('completa el ingreso importado del mes siguiente con el mismo neto', async () => {
    await base.ingresos.add({ id: 'banco', anio: 2026, mes: 6, pagadorId: 'p', bruto: 150895, seguridadSocial: 0, retencionIRPF: 0, neto: 150895, netoManual: false, estado: 'Real', nota: '', pendienteNomina: true, huella: 'h' });
    const r = await aplicarNomina(nomina, { anio: 2026, mes: 5 }, 'p', base);
    expect(r).toEqual({ accion: 'completada', ingresoId: 'banco' });
    const i = await base.ingresos.get('banco');
    expect(i).toMatchObject({ bruto: 185000, seguridadSocial: 12005, retencionIRPF: 22100, neto: 150895, netoManual: false, huella: 'h' });
    expect(i?.pendienteNomina).toBeUndefined();
  });

  it('sin ingreso del banco, lo crea en el mes de la nómina', async () => {
    const r = await aplicarNomina(nomina, { anio: 2026, mes: 5 }, 'p', base);
    expect(r.accion).toBe('creada');
    expect(await base.ingresos.get(r.ingresoId)).toMatchObject({ anio: 2026, mes: 5, neto: 150895, estado: 'Real' });
  });
});

describe('objetivos', () => {
  it('las aportaciones suman y nunca dejan el objetivo en negativo', async () => {
    await guardarObjetivo({ id: 'o', nombre: 'Viaje', importeObjetivo: 100000, importeActual: 0, aportacionMensual: 10000, fechaObjetivo: null, archivado: false }, base);
    await aportarObjetivo('o', 25000, base);
    await aportarObjetivo('o', -40000, base);
    expect((await base.objetivos.get('o'))?.importeActual).toBe(0);
  });
});
