import { MAX_CENTIMOS, TASA_UNIDAD } from './dinero';
import {
  CLAVES_CATEGORIA,
  CONCEPTOS_EXTRA,
  PERIODICIDADES,
  type Compromiso,
  type ObjetivoAhorro,
  idMes,
  TIPOS_GASTO,
  TIPOS_PAGADOR,
  type Ajustes,
  type Categoria,
  type Gasto,
  type Ingreso,
  type IngresoExtra,
  type MesRegistro,
  type Pagador,
  type ParametrosFiscales,
  type Importacion,
  type Presupuesto,
  type Regla,
  type Traspaso,
  type Porcentajes,
  type Tramo,
} from './modelo';
import type { DatosFinancieros } from './resumen';

export const APP_COPIA = 'finanzas-personales';
export const VERSION_ESQUEMA = 1;

export interface CopiaSeguridad {
  app: typeof APP_COPIA;
  schemaVersion: number;
  exportadoEl: string;
  datos: DatosFinancieros & { ajustes: Ajustes };
}

export type ResultadoValidacion = { ok: true; copia: CopiaSeguridad } | { ok: false; errores: string[] };

export function crearCopia(datos: DatosFinancieros, ajustes: Ajustes, ahora: Date): CopiaSeguridad {
  return { app: APP_COPIA, schemaVersion: VERSION_ESQUEMA, exportadoEl: ahora.toISOString(), datos: { ...datos, ajustes } };
}

// --- Validadores mínimos, sin dependencias -------------------------------------------------

type Registro = Record<string, unknown>;

class Validador {
  readonly errores: string[] = [];

  error(ruta: string, msg: string): void {
    if (this.errores.length < 20) this.errores.push(`${ruta}: ${msg}`);
  }

  objeto(v: unknown, ruta: string): v is Registro {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return true;
    this.error(ruta, 'debe ser un objeto');
    return false;
  }

  texto(o: Registro, k: string, ruta: string, opcional = false): boolean {
    const v = o[k];
    if (opcional && v === undefined) return true;
    if (typeof v === 'string' && v.length <= 2000) return true;
    this.error(`${ruta}.${k}`, 'debe ser texto');
    return false;
  }

  id(o: Registro, k: string, ruta: string): boolean {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0 && v.length <= 100) return true;
    this.error(`${ruta}.${k}`, 'identificador no válido');
    return false;
  }

  booleano(o: Registro, k: string, ruta: string): boolean {
    if (typeof o[k] === 'boolean') return true;
    this.error(`${ruta}.${k}`, 'debe ser sí/no');
    return false;
  }

  entero(o: Registro, k: string, ruta: string, min: number, max: number): boolean {
    const v = o[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return true;
    this.error(`${ruta}.${k}`, `debe ser un entero entre ${min} y ${max}`);
    return false;
  }

  centimos(o: Registro, k: string, ruta: string): boolean {
    return this.entero(o, k, ruta, 0, MAX_CENTIMOS);
  }

  tasa(o: Registro, k: string, ruta: string, max = TASA_UNIDAD): boolean {
    return this.entero(o, k, ruta, 0, max);
  }

  enumerado(o: Registro, k: string, ruta: string, valores: readonly string[]): boolean {
    const v = o[k];
    if (typeof v === 'string' && valores.includes(v)) return true;
    this.error(`${ruta}.${k}`, `debe ser uno de: ${valores.join(', ')}`);
    return false;
  }

  /** Metadatos de sincronización, opcionales (las copias antiguas no los tienen). */
  meta(o: Registro, ruta: string): void {
    if (o['actualizadoEl'] !== undefined) this.entero(o, 'actualizadoEl', ruta, 0, Number.MAX_SAFE_INTEGER);
    if (o['borrado'] !== undefined) this.booleano(o, 'borrado', ruta);
  }

  periodo(o: Registro, ruta: string): boolean {
    const a = this.entero(o, 'anio', ruta, 2000, 2100);
    const m = this.entero(o, 'mes', ruta, 1, 12);
    return a && m;
  }

  lista(v: unknown, ruta: string): unknown[] | null {
    if (Array.isArray(v)) return v as unknown[];
    this.error(ruta, 'debe ser una lista');
    return null;
  }
}

function datosImportacion(val: Validador, x: Registro, r: string): void {
  val.texto(x, 'importacion', r, true);
  if (x['fecha'] !== undefined && (typeof x['fecha'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x['fecha']))) val.error(`${r}.fecha`, 'fecha no válida');
  val.texto(x, 'cuenta', r, true);
  val.texto(x, 'huella', r, true);
  const ev = x['evidencia'];
  if (ev !== undefined && val.objeto(ev, `${r}.evidencia`)) {
    val.texto(ev, 'archivo', `${r}.evidencia`);
    val.entero(ev, 'fila', `${r}.evidencia`, 0, 10_000_000);
    if (ev['pagina'] !== undefined) val.entero(ev, 'pagina', `${r}.evidencia`, 1, 100_000);
  }
}

function validarTramos(val: Validador, v: unknown, ruta: string): v is Tramo[] {
  const lista = val.lista(v, ruta);
  if (!lista) return false;
  if (lista.length === 0) val.error(ruta, 'la escala no puede estar vacía');
  lista.forEach((t, i) => {
    if (val.objeto(t, `${ruta}[${i}]`)) {
      val.centimos(t, 'desde', `${ruta}[${i}]`);
      val.tasa(t, 'tipo', `${ruta}[${i}]`);
    }
  });
  return true;
}

function validarPorcentajesCopia(val: Validador, v: unknown, ruta: string): v is Porcentajes {
  if (!val.objeto(v, ruta)) return false;
  for (const k of ['colchon', 'inversion', 'objetivos', 'libre']) val.tasa(v, k, ruta);
  return true;
}

function validarFiscal(val: Validador, v: unknown, ruta: string): v is ParametrosFiscales {
  if (!val.objeto(v, ruta)) return false;
  val.entero(v, 'ejercicio', ruta, 2000, 2100);
  val.texto(v, 'revisadoEl', ruta);
  val.texto(v, 'nombreAutonomia', ruta);
  val.centimos(v, 'otrosGastos', ruta);
  val.centimos(v, 'minimoPersonal', ruta);
  val.booleano(v, 'incluirPropinas', ruta);
  const red = v['reduccion'];
  if (val.objeto(red, `${ruta}.reduccion`)) {
    for (const k of ['limite1', 'importeMaximo', 'limite2', 'importeTramo2', 'limite3']) val.centimos(red, k, `${ruta}.reduccion`);
    for (const k of ['coeficiente1', 'coeficiente2']) val.tasa(red, k, `${ruta}.reduccion`, 100 * TASA_UNIDAD);
  }
  validarTramos(val, v['escalaEstatal'], `${ruta}.escalaEstatal`);
  validarTramos(val, v['escalaAutonomica'], `${ruta}.escalaAutonomica`);
  const alq = v['alquiler'];
  if (val.objeto(alq, `${ruta}.alquiler`)) {
    val.centimos(alq, 'baseMaxima', `${ruta}.alquiler`);
    const tramos = val.lista(alq['tramos'], `${ruta}.alquiler.tramos`);
    tramos?.forEach((t, i) => {
      const r = `${ruta}.alquiler.tramos[${i}]`;
      if (val.objeto(t, r)) {
        val.entero(t, 'edadMenorQue', r, 0, 130);
        val.tasa(t, 'porcentaje', r);
        val.centimos(t, 'maximo', r);
      }
    });
  }
  const sb = v['sueldosBajos'];
  if (val.objeto(sb, `${ruta}.sueldosBajos`)) {
    val.booleano(sb, 'activa', `${ruta}.sueldosBajos`);
    for (const k of ['limite1', 'importe', 'limite2']) val.centimos(sb, k, `${ruta}.sueldosBajos`);
    val.tasa(sb, 'coeficiente', `${ruta}.sueldosBajos`, 100 * TASA_UNIDAD);
  }
  const ob = v['obligacion'];
  if (val.objeto(ob, `${ruta}.obligacion`)) {
    for (const k of ['limiteGeneral', 'limiteVariosPagadores', 'umbralSegundoPagador']) val.centimos(ob, k, `${ruta}.obligacion`);
  }
  return true;
}

function validarAjustes(val: Validador, v: unknown): v is Ajustes {
  const r = 'ajustes';
  if (!val.objeto(v, r)) return false;
  if (v['id'] !== 'ajustes') val.error(`${r}.id`, 'debe ser "ajustes"');
  val.entero(v, 'ahorroInicial', r, -MAX_CENTIMOS, MAX_CENTIMOS);
  val.entero(v, 'inicioAnio', r, 2000, 2100);
  val.entero(v, 'inicioMes', r, 1, 12);
  val.entero(v, 'mesesColchon', r, 1, 36);
  validarPorcentajesCopia(val, v['repartoIncompleto'], `${r}.repartoIncompleto`);
  validarPorcentajesCopia(val, v['repartoCompleto'], `${r}.repartoCompleto`);
  if (v['anioNacimiento'] !== null) val.entero(v, 'anioNacimiento', r, 1900, 2100);
  val.booleano(v, 'alquilerANombre', r);
  if (v['alquilerAnualManual'] !== null) val.centimos(v, 'alquilerAnualManual', r);
  validarFiscal(val, v['fiscal'], `${r}.fiscal`);
  if (v['ultimaCopia'] !== null) val.texto(v, 'ultimaCopia', r);
  val.enumerado(v, 'tema', r, ['auto', 'claro', 'oscuro']);
  val.meta(v, r);
  return true;
}

function idsUnicos(val: Validador, filas: readonly Registro[], ruta: string): Set<string> {
  const ids = new Set<string>();
  for (const f of filas) {
    const id = f['id'];
    if (typeof id === 'string') {
      if (ids.has(id)) val.error(ruta, `id repetido "${id}"`);
      ids.add(id);
    }
  }
  return ids;
}

function filasObjeto(val: Validador, datos: Registro, tabla: string, opcional = false): Registro[] {
  // Las tablas añadidas en versiones posteriores pueden no estar en copias antiguas.
  if (opcional && datos[tabla] === undefined) return [];
  const lista = val.lista(datos[tabla], `datos.${tabla}`) ?? [];
  const filas = lista.filter((f, i): f is Registro => val.objeto(f, `${tabla}[${i}]`));
  filas.forEach((f, i) => val.meta(f, `${tabla}[${i}]`));
  return filas;
}

export interface OpcionesValidacion {
  /**
   * Comprueba que cada ingreso y gasto apunte a un pagador o categoría existente.
   * En la sincronización se desactiva: una referencia rota no debe bloquear la fusión.
   */
  referencias: boolean;
}

export function validarCopia(entrada: unknown, opciones: OpcionesValidacion = { referencias: true }): ResultadoValidacion {
  const val = new Validador();
  if (!val.objeto(entrada, 'copia')) return { ok: false, errores: val.errores };
  if (entrada['app'] !== APP_COPIA) {
    return { ok: false, errores: ['El archivo no es una copia de seguridad de esta app.'] };
  }
  const version = entrada['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, errores: ['La copia no indica una versión de esquema válida.'] };
  }
  if (version > VERSION_ESQUEMA) {
    return { ok: false, errores: [`La copia es de una versión más nueva de la app (esquema ${version}). Actualiza la app antes de importarla.`] };
  }
  val.texto(entrada, 'exportadoEl', 'copia');
  const datos = entrada['datos'];
  if (!val.objeto(datos, 'datos')) return { ok: false, errores: val.errores };

  const pagadores = filasObjeto(val, datos, 'pagadores');
  pagadores.forEach((p, i) => {
    const r = `pagadores[${i}]`;
    val.id(p, 'id', r);
    val.texto(p, 'nombre', r);
    val.enumerado(p, 'tipo', r, TIPOS_PAGADOR);
    val.texto(p, 'nif', r, true);
    val.booleano(p, 'archivado', r);
  });
  const idsPagadores = idsUnicos(val, pagadores, 'pagadores');

  const categorias = filasObjeto(val, datos, 'categorias');
  categorias.forEach((c, i) => {
    const r = `categorias[${i}]`;
    val.id(c, 'id', r);
    val.texto(c, 'nombre', r);
    val.entero(c, 'orden', r, 0, 10_000);
    if (c['clave'] !== undefined) val.enumerado(c, 'clave', r, CLAVES_CATEGORIA);
    val.booleano(c, 'archivada', r);
  });
  const idsCategorias = idsUnicos(val, categorias, 'categorias');

  const ingresos = filasObjeto(val, datos, 'ingresos');
  ingresos.forEach((x, i) => {
    const r = `ingresos[${i}]`;
    val.id(x, 'id', r);
    val.periodo(x, r);
    if (val.id(x, 'pagadorId', r) && opciones.referencias && !idsPagadores.has(String(x['pagadorId']))) val.error(r, 'el pagador no existe en la copia');
    for (const k of ['bruto', 'seguridadSocial', 'retencionIRPF', 'neto']) val.centimos(x, k, r);
    val.booleano(x, 'netoManual', r);
    val.enumerado(x, 'estado', r, ['Real', 'Previsto']);
    val.texto(x, 'nota', r);
    if (x['pendienteNomina'] !== undefined) val.booleano(x, 'pendienteNomina', r);
    datosImportacion(val, x, r);
  });
  idsUnicos(val, ingresos, 'ingresos');

  const extras = filasObjeto(val, datos, 'extras');
  extras.forEach((x, i) => {
    const r = `extras[${i}]`;
    val.id(x, 'id', r);
    val.periodo(x, r);
    val.enumerado(x, 'concepto', r, CONCEPTOS_EXTRA);
    val.centimos(x, 'importe', r);
    val.texto(x, 'nota', r);
    datosImportacion(val, x, r);
  });
  idsUnicos(val, extras, 'extras');

  const gastos = filasObjeto(val, datos, 'gastos');
  gastos.forEach((x, i) => {
    const r = `gastos[${i}]`;
    val.id(x, 'id', r);
    val.periodo(x, r);
    if (val.id(x, 'categoriaId', r) && opciones.referencias && !idsCategorias.has(String(x['categoriaId']))) val.error(r, 'la categoría no existe en la copia');
    val.centimos(x, 'importe', r);
    val.enumerado(x, 'tipo', r, TIPOS_GASTO);
    val.texto(x, 'nota', r);
    val.texto(x, 'origen', r, true);
    val.texto(x, 'comercio', r, true);
    if (x['devolucion'] !== undefined) val.booleano(x, 'devolucion', r);
    datosImportacion(val, x, r);
  });
  idsUnicos(val, gastos, 'gastos');

  const meses = filasObjeto(val, datos, 'meses');
  meses.forEach((x, i) => {
    const r = `meses[${i}]`;
    if (val.periodo(x, r) && x['id'] !== idMes(Number(x['anio']), Number(x['mes']))) val.error(r, 'id de mes incoherente');
    val.booleano(x, 'confirmado', r);
  });

  const reglas = filasObjeto(val, datos, 'reglas', true);
  reglas.forEach((x, i) => {
    const r = `reglas[${i}]`;
    val.id(x, 'id', r);
    val.id(x, 'categoriaId', r);
    val.enumerado(x, 'tipo', r, TIPOS_GASTO);
  });
  idsUnicos(val, reglas, 'reglas');

  const traspasos = filasObjeto(val, datos, 'traspasos', true);
  traspasos.forEach((x, i) => {
    const r = `traspasos[${i}]`;
    val.id(x, 'id', r);
    val.periodo(x, r);
    val.texto(x, 'fecha', r);
    val.texto(x, 'cuenta', r);
    val.entero(x, 'importe', r, -MAX_CENTIMOS, MAX_CENTIMOS);
    val.enumerado(x, 'tipo', r, ['interno', 'hucha', 'divisa']);
    val.texto(x, 'pareja', r, true);
    val.texto(x, 'importacion', r, true);
  });
  idsUnicos(val, traspasos, 'traspasos');

  const presupuestos = filasObjeto(val, datos, 'presupuestos', true);
  presupuestos.forEach((x, i) => {
    const r = `presupuestos[${i}]`;
    val.id(x, 'id', r);
    val.centimos(x, 'importe', r);
  });
  idsUnicos(val, presupuestos, 'presupuestos');

  const importaciones = filasObjeto(val, datos, 'importaciones', true);
  importaciones.forEach((x, i) => {
    const r = `importaciones[${i}]`;
    val.id(x, 'id', r);
    val.texto(x, 'fecha', r);
    val.texto(x, 'desde', r);
    val.texto(x, 'hasta', r);
    val.entero(x, 'movimientos', r, 0, 1_000_000);
    if (!Array.isArray(x['cuentas']) || !x['cuentas'].every((c) => typeof c === 'string')) val.error(`${r}.cuentas`, 'debe ser una lista de textos');
    if (x['deshecha'] !== undefined) val.booleano(x, 'deshecha', r);
    if (x['archivos'] !== undefined && !Array.isArray(x['archivos'])) val.error(`${r}.archivos`, 'debe ser una lista');
  });
  idsUnicos(val, importaciones, 'importaciones');

  const compromisos = filasObjeto(val, datos, 'compromisos', true);
  compromisos.forEach((x, i) => {
    const r = `compromisos[${i}]`;
    val.id(x, 'id', r);
    val.texto(x, 'nombre', r);
    val.id(x, 'categoriaId', r);
    val.centimos(x, 'importe', r);
    val.enumerado(x, 'periodicidad', r, PERIODICIDADES);
    val.entero(x, 'ultimoAnio', r, 2000, 2100);
    val.entero(x, 'ultimoMes', r, 1, 12);
    val.booleano(x, 'activo', r);
    val.enumerado(x, 'origen', r, ['detectado', 'manual']);
  });
  idsUnicos(val, compromisos, 'compromisos');

  const objetivos = filasObjeto(val, datos, 'objetivos', true);
  objetivos.forEach((x, i) => {
    const r = `objetivos[${i}]`;
    val.id(x, 'id', r);
    val.texto(x, 'nombre', r);
    val.centimos(x, 'importeObjetivo', r);
    val.centimos(x, 'importeActual', r);
    val.centimos(x, 'aportacionMensual', r);
    if (x['fechaObjetivo'] !== null && (typeof x['fechaObjetivo'] !== 'string' || !/^\d{4}-\d{2}$/.test(x['fechaObjetivo']))) val.error(`${r}.fechaObjetivo`, 'debe ser aaaa-mm o null');
    val.booleano(x, 'archivado', r);
  });
  idsUnicos(val, objetivos, 'objetivos');

  const ajustes = datos['ajustes'];
  validarAjustes(val, ajustes);

  if (val.errores.length > 0) return { ok: false, errores: val.errores };

  // Tras la validación estructural, los tipos coinciden con el modelo.
  return {
    ok: true,
    copia: {
      app: APP_COPIA,
      schemaVersion: version,
      exportadoEl: String(entrada['exportadoEl']),
      datos: {
        pagadores: pagadores as unknown as Pagador[],
        categorias: categorias as unknown as Categoria[],
        ingresos: ingresos as unknown as Ingreso[],
        extras: extras as unknown as IngresoExtra[],
        gastos: gastos as unknown as Gasto[],
        meses: meses as unknown as MesRegistro[],
        reglas: reglas as unknown as Regla[],
        traspasos: traspasos as unknown as Traspaso[],
        presupuestos: presupuestos as unknown as Presupuesto[],
        importaciones: importaciones as unknown as Importacion[],
        compromisos: compromisos as unknown as Compromiso[],
        objetivos: objetivos as unknown as ObjetivoAhorro[],
        ajustes: ajustes as Ajustes,
      },
    },
  };
}

export function leerCopia(texto: string): ResultadoValidacion {
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { ok: false, errores: ['El archivo no es un JSON válido (puede estar dañado o incompleto).'] };
  }
  return validarCopia(json);
}
