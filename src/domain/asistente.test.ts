import { describe, expect, it } from 'vitest';
import { interpretar, interpretarConIA, responder, validarConsulta } from './asistente';
import { euros } from './dinero';
import type { Categoria, Gasto } from './modelo';
import type { DatosFinancieros } from './resumen';

const categorias: Categoria[] = [
  { id: 'res', nombre: 'Restaurantes y bares', orden: 0, clave: 'restaurantes', archivada: false },
  { id: 'com', nombre: 'Comida', orden: 1, clave: 'comida', archivada: false },
  { id: 'sus', nombre: 'Suscripciones', orden: 2, clave: 'suscripciones', archivada: false },
];
const hoy = { anio: 2026, mes: 5 };
let n = 0;
const g = (anio: number, mes: number, cat: string, imp: number, extra: Partial<Gasto> = {}): Gasto => ({ id: `g${n++}`, anio, mes, categoriaId: cat, importe: euros(imp), tipo: 'Variable', nota: '', ...extra });
const datos: DatosFinancieros = {
  pagadores: [], categorias,
  ingresos: [
    { id: 'i1', anio: 2026, mes: 3, pagadorId: 'e', bruto: 0, seguridadSocial: 0, retencionIRPF: 0, neto: euros(1500), netoManual: false, estado: 'Real', nota: '' },
    { id: 'i2', anio: 2026, mes: 6, pagadorId: 'e', bruto: 0, seguridadSocial: 0, retencionIRPF: 0, neto: euros(1800), netoManual: false, estado: 'Previsto', nota: '' },
  ],
  extras: [{ id: 'x', anio: 2026, mes: 3, concepto: 'Propinas', importe: euros(200), nota: '' }],
  gastos: [
    g(2026, 3, 'res', 40, { comercio: 'Taberna Sa Punta', huella: 'h1', fecha: '2026-03-05' }),
    g(2026, 3, 'res', 60, { comercio: 'Bar Can Pep', huella: 'h2', fecha: '2026-03-09' }),
    g(2026, 4, 'res', 150, { comercio: 'Bar Can Pep' }),
    g(2026, 3, 'com', 300, { comercio: 'Mercadona', huella: 'h3' }),
    g(2025, 3, 'res', 999),
  ],
  meses: [], reglas: [], traspasos: [], presupuestos: [], importaciones: [],
  compromisos: [{ id: 'c', nombre: 'Netflix', categoriaId: 'sus', importe: euros(12.99), periodicidad: 'mensual', ultimoAnio: 2026, ultimoMes: 4, activo: true, origen: 'detectado' }],
  objetivos: [{ id: 'o', nombre: 'Viaje', importeObjetivo: euros(1000), importeActual: euros(250), aportacionMensual: euros(150), fechaObjetivo: null, archivado: false }],
};
const sp = (t: string) => t.replace(/\s/g, ' ');

describe('interpretar preguntas', () => {
  it.each([
    ['¿Cuánto gasté en restaurantes este año?', { tipo: 'gasto', desde: { anio: 2026, mes: 1 }, hasta: hoy, categoriaId: 'res' }],
    ['cuanto me deje en bares en marzo', { tipo: 'gasto', desde: { anio: 2026, mes: 3 }, hasta: { anio: 2026, mes: 3 }, categoriaId: 'res' }],
    ['Compara restaurantes de marzo frente a abril', { tipo: 'comparar', desde: { anio: 2026, mes: 3 }, hasta: { anio: 2026, mes: 3 }, desde2: { anio: 2026, mes: 4 }, hasta2: { anio: 2026, mes: 4 }, categoriaId: 'res' }],
    ['¿En qué gasto más el mes pasado?', { tipo: 'categorias', desde: { anio: 2026, mes: 4 }, hasta: { anio: 2026, mes: 4 } }],
    ['¿Cuánto ahorré en los últimos 3 meses?', { tipo: 'resultado', desde: { anio: 2026, mes: 3 }, hasta: hoy }],
    ['mis suscripciones', { tipo: 'recurrentes', desde: { anio: 2026, mes: 1 }, hasta: hoy }],
    ['¿Cómo van mis objetivos?', { tipo: 'objetivos', desde: { anio: 2026, mes: 1 }, hasta: hoy }],
    ['¿cuánto cobré en diciembre?', { tipo: 'ingreso', desde: { anio: 2025, mes: 12 }, hasta: { anio: 2025, mes: 12 } }],
  ])('%s', (pregunta, esperado) => {
    expect(interpretar(pregunta, hoy, categorias)).toEqual(esperado);
  });

  it('reconoce comercios y no entiende lo que no es una pregunta financiera', () => {
    expect(interpretar('pagos a bar can pep este año', hoy, categorias, ['Bar Can Pep'])).toMatchObject({ tipo: 'movimientos', comercio: 'Bar Can Pep' });
    expect(interpretar('hola qué tal', hoy, categorias)).toBeNull();
  });
});

describe('respuestas con cifras exactas y evidencia', () => {
  it('gasto por categoría con media, lista y origen de los datos', () => {
    const r = responder({ tipo: 'gasto', desde: { anio: 2026, mes: 3 }, hasta: { anio: 2026, mes: 4 }, categoriaId: 'res' }, datos, hoy);
    expect(r.cifras).toEqual([{ etiqueta: 'Total', importe: 25000 }, { etiqueta: 'Media mensual', importe: 12500 }]);
    expect(sp(r.texto)).toBe('Has gastado 250,00 € en Restaurantes y bares (marzo 2026 – abril 2026): una media de 125,00 € al mes.');
    expect(r.evidencia).toBe('3 movimientos en 2 meses: 2 importados del banco (verificados al importar) y 1 apuntados a mano.');
    expect(r.movimientos[0]).toEqual({ fecha: '2026-04', concepto: 'Bar Can Pep', importe: -15000 });
  });

  it('ingresos: lo previsto va aparte y no se suma', () => {
    const r = responder({ tipo: 'ingreso', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 12 } }, datos, hoy);
    expect(r.cifras).toEqual([
      { etiqueta: 'Nóminas y SEPE (real)', importe: 150000 },
      { etiqueta: 'Propinas y otros', importe: 20000 },
      { etiqueta: 'Previsto (aparte)', importe: 180000 },
    ]);
  });

  it('recurrentes y objetivos', () => {
    expect(responder({ tipo: 'recurrentes', desde: hoy, hasta: hoy }, datos, hoy).cifras).toEqual([{ etiqueta: 'Netflix (mensual)', importe: 1299 }]);
    expect(sp(responder({ tipo: 'objetivos', desde: hoy, hasta: hoy }, datos, hoy).texto)).toBe('Viaje: 250,00 € de 1000,00 € (25 %), al ritmo actual en octubre 2026.');
  });
});

describe('consultas de la IA', () => {
  it('solo se aceptan si son válidas', () => {
    expect(validarConsulta({ tipo: 'gasto', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 3 }, categoria: 'Comida' }, categorias)).toEqual({
      tipo: 'gasto', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 3 }, categoriaId: 'com',
    });
    expect(validarConsulta({ tipo: 'borrar', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 3 } }, categorias)).toBeNull();
    expect(validarConsulta({ tipo: 'gasto', desde: { anio: 2026, mes: 5 }, hasta: { anio: 2026, mes: 3 } }, categorias)).toBeNull();
    expect(validarConsulta({ tipo: 'gasto', desde: { anio: 2026, mes: 13 }, hasta: { anio: 2026, mes: 3 } }, categorias)).toBeNull();
    expect(validarConsulta({ tipo: 'comparar', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 1 } }, categorias)).toBeNull();
  });
});

describe('pregunta libre con la IA local', () => {
  it('la consulta de la IA se valida; si no es válida, no se responde', async () => {
    const motor = (texto: string) => ({ generar: () => Promise.resolve(texto) });
    const buena = JSON.stringify({ tipo: 'gasto', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 4 }, categoria: 'Comida' });
    expect(await interpretarConIA(motor(buena), 'lo del super de este año', hoy, categorias)).toEqual({ tipo: 'gasto', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 4 }, categoriaId: 'com' });
    expect(await interpretarConIA(motor('{"tipo":"gasto"'), 'x', hoy, categorias)).toBeNull();
    expect(await interpretarConIA({ generar: () => Promise.reject(new Error('sin GPU')) }, 'x', hoy, categorias)).toBeNull();
  });
});
