import Dexie, { type EntityTable } from 'dexie';
import type { Ajustes, Categoria, Compromiso, Gasto, Ingreso, IngresoExtra, MesRegistro, MetaSync, Importacion, ObjetivoAhorro, Pagador, Presupuesto, Regla, Traspaso } from '../domain/modelo';
import { ajustesPorDefecto, CATEGORIAS_POR_DEFECTO } from '../domain/parametros';

export function nuevoId(): string {
  return crypto.randomUUID();
}

/** "Móvil/Internet" → "cat-movil-internet" */
export function idCategoriaPorDefecto(nombre: string): string {
  const slug = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `cat-${slug}`;
}

export function normalizarNombre(n: string): string {
  return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

let ultimaMarca = 0;

/** Milisegundos estrictamente crecientes en este dispositivo (dos escrituras seguidas nunca empatan). */
export function marcaTiempo(): number {
  ultimaMarca = Math.max(Date.now(), ultimaMarca + 1);
  return ultimaMarca;
}

/** Devuelve la fila lista para guardar como cambio local: fechada y sin marca de borrado. */
export function sellar<T extends MetaSync>(fila: T): T {
  const { borrado: _borrado, ...resto } = fila;
  return { ...resto, actualizadoEl: marcaTiempo() } as T;
}

/** Configuración de la sincronización. Solo vive en este dispositivo: no se exporta ni se sincroniza. */
export interface ConfigSync {
  id: 'config';
  /** "usuario/repositorio" */
  repo: string;
  token: string;
  sal: string;
  iteraciones: number;
  /** Clave AES no extraíble derivada de la contraseña. */
  clave: CryptoKey;
  ultimaSync: string | null;
}

/**
 * Esquema versionado. Para añadir la pestaña de inversiones más adelante:
 *   this.version(3).stores({ aportaciones: 'id, [anio+mes], anio', operaciones: 'id, anio, activo' })
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
  config!: EntityTable<ConfigSync, 'id'>;
  reglas!: EntityTable<Regla, 'id'>;
  traspasos!: EntityTable<Traspaso, 'id'>;
  presupuestos!: EntityTable<Presupuesto, 'id'>;
  importaciones!: EntityTable<Importacion, 'id'>;
  compromisos!: EntityTable<Compromiso, 'id'>;
  objetivos!: EntityTable<ObjetivoAhorro, 'id'>;

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

    // v2: sincronización. Se fechan los datos existentes para que participen en la primera fusión.
    this.version(2)
      .stores({ config: 'id' })
      .upgrade(async (tx) => {
        const marca = Date.now();
        for (const t of ['pagadores', 'categorias', 'ingresos', 'extras', 'gastos', 'meses', 'ajustes']) {
          await tx
            .table<MetaSync & { id: string }, string>(t)
            .toCollection()
            .modify((f) => {
              f.actualizadoEl ??= marca;
            });
        }
      });

    // v3: importador de extractos. Tablas nuevas, índice de huella y categorías ampliadas.
    this.version(3)
      .stores({
        ingresos: 'id, [anio+mes], anio, pagadorId, huella',
        extras: 'id, [anio+mes], anio, huella',
        gastos: 'id, [anio+mes], anio, categoriaId, origen, huella',
        reglas: 'id',
        traspasos: 'id, [anio+mes], anio',
        presupuestos: 'id',
      })
      .upgrade(async (tx) => {
        const categorias = tx.table<Categoria, string>('categorias');
        const existentes = await categorias.toArray();
        const marca = Date.now();
        // Reconoce las categorías existentes por nombre para que el importador sepa cuál es cuál.
        for (const c of existentes) {
          if (c.clave || c.borrado) continue;
          const defecto = CATEGORIAS_POR_DEFECTO.find((d) => normalizarNombre(d.nombre) === normalizarNombre(c.nombre));
          if (defecto) await categorias.put({ ...c, clave: defecto.clave, actualizadoEl: marca });
        }
        // Añade las que falten, con id fijo y marca 0 (como una instalación nueva).
        const conClave = new Set((await categorias.toArray()).filter((c) => !c.borrado).map((c) => c.clave));
        let orden = existentes.length;
        for (const d of CATEGORIAS_POR_DEFECTO) {
          if (conClave.has(d.clave)) continue;
          const id = idCategoriaPorDefecto(d.nombre);
          if (await categorias.get(id)) continue;
          await categorias.add({ id, nombre: d.nombre, orden: orden++, clave: d.clave, archivada: false, actualizadoEl: 0 });
        }
      });

    // v4: registro de importaciones para poder deshacerlas.
    this.version(4).stores({ importaciones: 'id, fecha' });

    // v5: pagos recurrentes (para la previsión) y objetivos de ahorro.
    this.version(5).stores({ compromisos: 'id', objetivos: 'id' });

    this.on('populate', (tx) => {
      // Identificadores fijos y marca 0: un dispositivo recién instalado coincide con los demás
      // y nunca pisa categorías o pagadores que ya hayas cambiado en otro.
      void tx.table<Categoria, string>('categorias').bulkAdd(
        CATEGORIAS_POR_DEFECTO.map((c, orden) => ({
          id: idCategoriaPorDefecto(c.nombre),
          nombre: c.nombre,
          orden,
          archivada: false,
          actualizadoEl: 0,
          clave: c.clave,
        })),
      );
      void tx.table<Pagador, string>('pagadores').bulkAdd([
        { id: 'pag-sepe', nombre: 'SEPE', tipo: 'SEPE', archivado: false, actualizadoEl: 0 },
        { id: 'pag-empresa', nombre: 'Empresa', tipo: 'Empresa', archivado: false, actualizadoEl: 0 },
      ]);
      void tx.table<Ajustes, string>('ajustes').add({ ...ajustesPorDefecto(), actualizadoEl: 0 });
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

// --- Aviso de cambios locales (para programar la sincronización) ---------------------------

type Oyente = () => void;
const oyentes = new Set<Oyente>();

export function alCambiarDatos(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function notificarCambio(): void {
  for (const o of oyentes) o();
}

/** Tablas de datos (las que se sincronizan) más ajustes: para abrir transacciones sobre todo. */
export function tablasDatos(base: BaseDatos) {
  return [
    base.pagadores, base.categorias, base.ingresos, base.extras, base.gastos, base.meses, base.reglas,
    base.traspasos, base.presupuestos, base.importaciones, base.compromisos, base.objetivos, base.ajustes,
  ];
}
