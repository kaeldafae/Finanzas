import { describe, expect, it } from 'vitest';
import { cuadrar } from './cuadre';
import { diagnosticoAnonimo, inferirPorContenido, leerExtracto, type LecturaExtracto } from './formatos';
import { prepararImportacion, type ExtractoLeido } from './importar';
import { claveSuelta } from './huella';
import { parsearFecha, type Celda } from './texto';

describe('fechas con el mes en letra', () => {
  it.each([
    ['1 ene 2026', '2026-01-01'],
    ['15 ene. 2026', '2026-01-15'],
    ['3 de marzo de 2026', '2026-03-03'],
    ['Jan 2, 2026', '2026-01-02'],
    ['2 Feb 2026', '2026-02-02'],
    ['12 set. 2026', '2026-09-12'],
    ['31 feb 2026', null],
    ['1 foo 2026', null],
  ])('%s', (t, esperado) => {
    expect(parsearFecha(t)).toBe(esperado);
  });
});

describe('columnas detectadas por su contenido', () => {
  it('sin títulos reconocibles: elige fecha, concepto, importe y saldo verificando con el saldo', () => {
    const filas: Celda[][] = [
      ['Mi banco raro'],
      ['Día', 'Qué', 'Cuánto', 'Queda', 'Oficina'],
      ['01/03/2026', 'Mercadona', '-45,30', '554,70', '0049'],
      ['02/03/2026', 'Nomina Hoteles', '1.200,00', '1.754,70', '0049'],
      ['03/03/2026', 'Endesa', '-48,20', '1.706,50', '0049'],
    ];
    const l = leerExtracto(filas);
    expect(l?.deteccion).toBe('contenido');
    expect(l?.movimientos.map((m) => [m.concepto, m.importe, m.saldo])).toEqual([
      ['Mercadona', -4530, 55470],
      ['Nomina Hoteles', 120000, 175470],
      ['Endesa', -4820, 170650],
    ]);
  });

  it('cargo y abono en columnas separadas y en positivo', () => {
    const filas: Celda[][] = [
      ['05/03/2026', 'Bar Can Pep', 12.5, null, 987.5],
      ['06/03/2026', 'Transferencia recibida', null, 300, 1287.5],
      ['07/03/2026', 'Farmacia', 8.2, null, 1279.3],
    ];
    const l = inferirPorContenido(filas);
    expect(l?.movimientos.map((m) => m.importe)).toEqual([-1250, 30000, -820]);
    expect(l && cuadrar(l.movimientos).estado).toBe('ok');
  });

  it('banco que pone los cargos en positivo en una sola columna: lo resuelve el saldo', () => {
    const filas: Celda[][] = [
      ['05/03/2026', 'Bar Can Pep', 12.5, 987.5],
      ['06/03/2026', 'Bar Can Pep', 10, 977.5],
      ['07/03/2026', 'Farmacia', 7.5, 970],
    ];
    expect(inferirPorContenido(filas)?.movimientos.map((m) => m.importe)).toEqual([-1250, -1000, -750]);
  });

  it('sin saldo y con dos columnas numéricas: no adivina', () => {
    const filas: Celda[][] = [
      ['05/03/2026', 'Bar', 12.5, 3],
      ['06/03/2026', 'Farmacia', -10, 4],
    ];
    expect(inferirPorContenido(filas)).toBeNull();
  });

  it('sin saldo y una sola columna de importes con signo: se acepta (sin verificar)', () => {
    const filas: Celda[][] = [
      ['05/03/2026', 'Bar', '-12,50'],
      ['06/03/2026', 'Nómina', '1.000,00'],
    ];
    const l = inferirPorContenido(filas);
    expect(l?.movimientos.map((m) => m.importe)).toEqual([-1250, 100000]);
    expect(l && cuadrar(l.movimientos).estado).toBe('sin-saldo');
  });

  it('el diagnóstico describe la estructura sin revelar datos', () => {
    const filas: Celda[][] = [
      ['Día', 'Qué', 'Cuánto'],
      ['01/03/2026', 'Mercadona Ibiza', '-45,30'],
    ];
    const d = diagnosticoAnonimo(filas);
    expect(d).toContain('Columna 1: fecha');
    expect(d).toContain('Columna 3: importe');
    expect(d).not.toMatch(/Mercadona|45,30|2026/);
  });
});

describe('duplicados entre formatos (PDF frente a CSV)', () => {
  const extracto = (concepto: string, fecha = '2026-03-03'): ExtractoLeido => {
    const movimientos = [{ fila: 2, fecha, concepto, importe: -4530, comision: 0, saldo: 55470, tipoBanco: null, producto: null }];
    const lectura = { formato: 'revolut', banco: 'Revolut', movimientos, descartados: [], cabeceras: [], deteccion: 'pdf' } as unknown as LecturaExtracto;
    return { cuenta: 'Revolut', lectura, cuadre: cuadrar(movimientos) };
  };

  it('mismo día, importe y cuenta con otro texto: ya importado', async () => {
    const importados = new Map([[claveSuelta('Revolut', '2026-03-03', -4530), 1]]);
    const [m] = await prepararImportacion([extracto('Mercadona Tarjeta: 5374******')], new Map(), new Set(), null, importados);
    expect(m?.duplicado).toBe(true);
  });

  it('dos compras iguales el mismo día y solo una importada: la segunda es nueva', async () => {
    const importados = new Map([[claveSuelta('Revolut', '2026-03-03', -4530), 1]]);
    const ex = extracto('Mercadona');
    const primero = ex.cuadre.ordenados[0];
    if (!primero) throw new Error('sin movimientos');
    const doble = { ...ex, cuadre: { ...ex.cuadre, ordenados: [primero, { ...primero, fila: 3 }] } };
    const movs = await prepararImportacion([doble], new Map(), new Set(), null, importados);
    expect(movs.map((m) => m.duplicado)).toEqual([true, false]);
  });

  it('el mismo importe un día antes queda como posible duplicado para revisar', async () => {
    const importados = new Map([[claveSuelta('Revolut', '2026-03-02', -4530), 1]]);
    const [m] = await prepararImportacion([extracto('Mercadona')], new Map(), new Set(), null, importados);
    expect(m?.duplicado).toBe(false);
    expect(m?.posibleDuplicado).toBe(true);
  });

  it('otra cuenta con el mismo importe no es duplicado', async () => {
    const importados = new Map([[claveSuelta('Santander', '2026-03-03', -4530), 1]]);
    const [m] = await prepararImportacion([extracto('Mercadona')], new Map(), new Set(), null, importados);
    expect(m?.duplicado).toBe(false);
    expect(m?.posibleDuplicado).toBeUndefined();
  });
});
