import Dexie, { type EntityTable } from 'dexie';
import type { Ajustes, Categoria, Gasto, Ingreso, IngresoExtra, MesRegistro, Pagador } from '../domain/modelo';
import { ajustesPorDefecto, CATEGORIAS_POR_DEFECTO } from '../domain/parametros';

export function nuevoId(): string {
  return crypto.randomUUID();
}

/**
 * Esquema versionado. Para añadir la pestaña de inversiones más adelante:
 *   this.version(2).stores({ aportaciones: 'id, [anio+mes], anio', operaciones: 'id, anio, activo' })
 * Las versiones anteriores se conservan para que Dexie migre los datos existentes.
 */
export class BaseDatos extends Dexie {
  pagadores!: EntityTable<Pagador, 'id'>;
  categorias!: EntityTable<Categoria, 'id'>;
  ingresos!: EntityTable<Ingreso, 'id'>;
  extras!: EntityTable<IngresoExtra, 'id'>;
  gastos!: EntityTable<Gasto, 'id'>;
  meses!: EntityTable<MesRegistro, 'id'>;
  ajustes!: EntityTable<Ajustes, 'id'>;

  constructor(nombre = 'finanzas-personales') {
    super(nombre);
    this.version(1).stores({
      pagadores: 'id, tipo',
      categorias: 'id, orden',
      ingresos: 'id, [anio+mes], anio, pagadorId',
      extras: 'id, [anio+mes], anio',
      gastos: 'id, [anio+mes], anio, categoriaId, origen',
      meses: 'id, anio',
      ajustes: 'id',
    });

    this.on('populate', (tx) => {
      void tx.table<Categoria, string>('categorias').bulkAdd(
        CATEGORIAS_POR_DEFECTO.map((c, orden) => ({
          id: nuevoId(),
          nombre: c.nombre,
          orden,
          archivada: false,
          ...(c.clave ? { clave: c.clave } : {}),
        })),
      );
      void tx.table<Pagador, string>('pagadores').bulkAdd([
        { id: nuevoId(), nombre: 'SEPE', tipo: 'SEPE', archivado: false },
        { id: nuevoId(), nombre: 'Empresa', tipo: 'Empresa', archivado: false },
      ]);
      void tx.table<Ajustes, string>('ajustes').add(ajustesPorDefecto());
    });
  }
}

export const db = new BaseDatos();

/** Completa con valores por defecto los campos que falten (p. ej., tras actualizar la app). */
export function normalizarAjustes(guardados: Partial<Ajustes> | undefined): Ajustes {
  const def = ajustesPorDefecto();
  if (!guardados) return def;
  const fiscal = guardados.fiscal;
  return {
    ...def,
    ...guardados,
    id: 'ajustes',
    fiscal: fiscal
      ? {
          ...def.fiscal,
          ...fiscal,
          reduccion: { ...def.fiscal.reduccion, ...fiscal.reduccion },
          alquiler: { ...def.fiscal.alquiler, ...fiscal.alquiler },
          sueldosBajos: { ...def.fiscal.sueldosBajos, ...fiscal.sueldosBajos },
          obligacion: { ...def.fiscal.obligacion, ...fiscal.obligacion },
        }
      : def.fiscal,
  };
}
