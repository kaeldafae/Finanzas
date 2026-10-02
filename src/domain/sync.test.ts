import { describe, expect, it } from 'vitest';
import type { Gasto } from './modelo';
import { ajustesPorDefecto } from './parametros';
import { fusionar, fusionarFilas, purgarBorrados, sonIguales, unificarCatalogos, type Instantanea } from './sync';

const g = (id: string, importe: number, actualizadoEl: number, borrado?: boolean): Gasto => ({
  id, anio: 2026, mes: 1, categoriaId: 'c', importe, tipo: 'Fijo', nota: '', actualizadoEl, ...(borrado ? { borrado } : {}),
});

function inst(parcial: Partial<Instantanea>): Instantanea {
  return { pagadores: [], categorias: [], ingresos: [], extras: [], gastos: [], meses: [], ajustes: ajustesPorDefecto(), ...parcial };
}

describe('fusión de registros', () => {
  it('gana la edición más reciente', () => {
    const r = fusionarFilas([g('a', 100, 10)], [g('a', 200, 20)]);
    expect(r).toEqual([g('a', 200, 20)]);
    expect(fusionarFilas([g('a', 300, 30)], [g('a', 200, 20)])[0]?.importe).toBe(300);
  });

  it('une registros que solo existen en un lado', () => {
    expect(fusionarFilas([g('a', 1, 1)], [g('b', 2, 2)]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('un borrado reciente gana a una edición antigua y no "resucita"', () => {
    const r = fusionarFilas([g('a', 100, 10)], [g('a', 100, 20, true)]);
    expect(r[0]?.borrado).toBe(true);
  });

  it('una edición posterior al borrado lo recupera (gana lo último)', () => {
    expect(fusionarFilas([g('a', 150, 30)], [g('a', 100, 20, true)])[0]?.borrado).toBeUndefined();
  });

  it('el empate se resuelve igual en cualquier orden (todos los dispositivos convergen)', () => {
    const x = g('a', 100, 10);
    const y = g('a', 999, 10);
    expect(fusionarFilas([x], [y])).toEqual(fusionarFilas([y], [x]));
    const b = g('a', 100, 10, true);
    expect(fusionarFilas([x], [b])[0]?.borrado).toBe(true);
    expect(fusionarFilas([b], [x])[0]?.borrado).toBe(true);
  });

  it('es idempotente', () => {
    const a = inst({ gastos: [g('a', 1, 5), g('b', 2, 6, true)] });
    const b = inst({ gastos: [g('a', 3, 7), g('c', 4, 1)] });
    const f = fusionar(a, b);
    expect(fusionar(f, b)).toEqual(f);
    expect(fusionar(f, f)).toEqual(f);
    expect(sonIguales(f, fusionar(b, a))).toBe(true);
  });

  it('los ajustes se fusionan por fecha pero el tema es de cada dispositivo', () => {
    const local = inst({ ajustes: { ...ajustesPorDefecto(), tema: 'oscuro', mesesColchon: 6, actualizadoEl: 5 } });
    const remota = inst({ ajustes: { ...ajustesPorDefecto(), tema: 'claro', mesesColchon: 9, actualizadoEl: 9 } });
    const f = fusionar(local, remota);
    expect(f.ajustes.mesesColchon).toBe(9);
    expect(f.ajustes.tema).toBe('oscuro');
  });
});

describe('purga de borrados', () => {
  it('elimina marcas de borrado de más de 90 días y conserva las recientes y los vivos', () => {
    const dia = 86_400_000;
    const ahora = 200 * dia;
    const d = inst({ gastos: [g('viejo', 1, ahora - 91 * dia, true), g('reciente', 1, ahora - 10 * dia, true), g('vivo', 1, 0)] });
    expect(purgarBorrados(d, ahora).gastos.map((x) => x.id)).toEqual(['reciente', 'vivo']);
  });
});

describe('unificar catálogos al conectar un dispositivo con datos', () => {
  it('reasigna los movimientos al pagador y categoría remotos con el mismo nombre', () => {
    const local = inst({
      pagadores: [{ id: 'p-local', nombre: 'SEPE', tipo: 'SEPE', archivado: false, actualizadoEl: 1 }],
      categorias: [{ id: 'c-local', nombre: 'Alquiler', orden: 0, clave: 'alquiler', archivada: false, actualizadoEl: 1 }],
      ingresos: [{ id: 'i', anio: 2026, mes: 1, pagadorId: 'p-local', bruto: 1, seguridadSocial: 0, retencionIRPF: 0, neto: 1, netoManual: false, estado: 'Real', nota: '', actualizadoEl: 1 }],
      gastos: [{ ...g('g', 1, 1), categoriaId: 'c-local' }],
    });
    const remota = inst({
      pagadores: [{ id: 'p-remoto', nombre: 'sepe', tipo: 'SEPE', archivado: false, actualizadoEl: 1 }],
      categorias: [{ id: 'c-remoto', nombre: 'Alquiler vivienda', orden: 0, clave: 'alquiler', archivada: false, actualizadoEl: 1 }],
    });
    const u = unificarCatalogos(local, remota, 50);
    expect(u.ingresos[0]?.pagadorId).toBe('p-remoto');
    expect(u.gastos[0]?.categoriaId).toBe('c-remoto');
    expect(u.pagadores[0]?.borrado).toBe(true);
    expect(u.categorias[0]?.borrado).toBe(true);
    const f = fusionar(u, remota);
    expect(f.pagadores.filter((p) => !p.borrado)).toHaveLength(1);
  });

  it('no toca nada si los ids ya coinciden', () => {
    const p = { id: 'pag-sepe', nombre: 'SEPE', tipo: 'SEPE' as const, archivado: false, actualizadoEl: 0 };
    const local = inst({ pagadores: [p] });
    expect(unificarCatalogos(local, inst({ pagadores: [p] }), 9)).toBe(local);
  });
});
