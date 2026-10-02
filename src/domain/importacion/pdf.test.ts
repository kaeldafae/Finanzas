import { describe, expect, it } from 'vitest';
import { cuadrar } from './cuadre';
import { leerPdfExtracto, tipoPorConcepto, type TextoPdf } from './pdf';
import { clasificar } from './clasificar';

/** Construye fragmentos como los que da pdf.js: cada texto con su x; los importes alineados a la derecha. */
function linea(pagina: number, y: number, celdas: readonly (readonly [number, string, ('izq' | 'der')?])[]): TextoPdf[] {
  return celdas.map(([x, texto, alineado]) => {
    const ancho = texto.length * 4.6;
    return { texto, x: alineado === 'der' ? x - ancho : x, y, ancho, alto: 9, pagina };
  });
}

// Columnas de un extracto tipo Revolut en español.
const X = { fecha: 40, desc: 120, sale: 380, entra: 460, saldo: 550 };
const cabecera = (p: number, y: number) =>
  linea(p, y, [[X.fecha, 'Fecha'], [X.desc, 'Descripción'], [X.sale, 'Dinero saliente', 'der'], [X.entra, 'Dinero entrante', 'der'], [X.saldo, 'Saldo', 'der']]);
const mov = (p: number, y: number, fecha: string, desc: string, sale: string, entra: string, saldo: string) =>
  linea(p, y, [
    [X.fecha, fecha],
    [X.desc, desc],
    ...(sale ? [[X.sale, sale, 'der'] as const] : []),
    ...(entra ? [[X.entra, entra, 'der'] as const] : []),
    ...(saldo ? [[X.saldo, saldo, 'der'] as const] : []),
  ]);

function extractoRevolut(): TextoPdf[] {
  return [
    ...linea(1, 800, [[40, 'Revolut Bank UAB'], [400, 'Extracto en EUR']]),
    ...linea(1, 760, [[40, 'Resumen del saldo']]),
    ...linea(1, 740, [[40, 'Producto'], [200, 'Saldo inicial', 'der'], [300, 'Dinero saliente', 'der'], [400, 'Dinero entrante', 'der'], [500, 'Saldo final', 'der']]),
    ...linea(1, 725, [[40, 'Cuenta (Corriente)'], [200, '0,00 €', 'der'], [300, '256,29 €', 'der'], [400, '605,30 €', 'der'], [500, '349,01 €', 'der']]),
    ...linea(1, 710, [[40, 'Total'], [200, '0,00 €', 'der'], [300, '256,29 €', 'der'], [400, '605,30 €', 'der'], [500, '349,01 €', 'der']]),
    ...linea(1, 670, [[40, 'Transacciones de la cuenta del 1 de marzo de 2026 al 31 de marzo de 2026']]),
    ...cabecera(1, 650),
    ...mov(1, 630, '1 mar 2026', 'Recarga de *1234', '', '600,00 €', '600,00 €'),
    ...mov(1, 612, '3 mar 2026', 'Mercadona', '45,30 €', '', '554,70 €'),
    ...linea(1, 602, [[X.desc, 'Tarjeta: 537410******1234']]),
    ...mov(1, 584, '5 mar 2026', 'Para Juan García López', '38,00 €', '', '516,70 €'),
    ...linea(1, 574, [[X.desc, 'Referencia: cena']]),
    ...mov(1, 556, '5 mar 2026', 'Netflix.com', '12,99 €', '', '503,71 €'),
    // Pie de página largo que menciona depósitos: no debe convertir lo siguiente en "hucha".
    ...linea(1, 60, [[40, 'Revolut Bank UAB está autorizado por el Banco de Lituania. Los depósitos están protegidos por el sistema de garantía de depósitos hasta 100.000 €.']]),
    ...linea(1, 45, [[40, 'Página 1 de 2']]),
    // Página 2: la cabecera se repite.
    ...cabecera(2, 800),
    ...mov(2, 780, '6 mar 2026', 'Al pocket EUR Viaje', '100,00 €', '', '403,71 €'),
    ...mov(2, 762, '8 mar 2026', 'Retirada de efectivo en Banco Santander', '51,00 €', '', '352,71 €'),
    ...mov(2, 744, '10 mar 2026', 'Reembolso de Mercadona', '', '5,30 €', '358,01 €'),
    ...mov(2, 726, '11 mar 2026', 'Cambiado a USD', '9,00 €', '', '349,01 €'),
    ...linea(2, 680, [[40, 'Transacciones pendientes desde 31 mar 2026']]),
    ...cabecera(2, 660),
    ...mov(2, 640, '31 mar 2026', 'Amazon', '20,00 €', '', ''),
    ...linea(2, 600, [[40, 'Hucha Viaje']]),
    ...cabecera(2, 580),
    ...mov(2, 560, '6 mar 2026', 'Desde la cuenta corriente', '', '100,00 €', '100,00 €'),
  ];
}

describe('PDF de extracto', () => {
  it('reconstruye los movimientos, une conceptos de dos líneas y descarta pendientes y hucha', () => {
    const { lectura, control } = leerPdfExtracto(extractoRevolut(), 2);
    expect(lectura).not.toBeNull();
    if (!lectura) return;
    expect(lectura.banco).toBe('Revolut');
    expect(lectura.deteccion).toBe('pdf');
    expect(lectura.movimientos.map((m) => [m.fecha, m.importe])).toEqual([
      ['2026-03-01', 60000],
      ['2026-03-03', -4530],
      ['2026-03-05', -3800],
      ['2026-03-05', -1299],
      ['2026-03-06', -10000],
      ['2026-03-08', -5100],
      ['2026-03-10', 530],
      ['2026-03-11', -900],
    ]);
    expect(lectura.movimientos[1]?.concepto).toBe('Mercadona Tarjeta: 537410******1234');
    expect(lectura.descartados.map((d) => d.motivo)).toEqual([
      'Operación no completada (pendiente)',
      'Movimiento dentro de una hucha: ya aparece en la cuenta principal',
    ]);
    expect(cuadrar(lectura.movimientos).estado).toBe('ok');
    expect(control?.ok).toBe(true);
    expect(control?.entradas).toBe(60530);
    expect(control?.salidas).toBe(25629);
  });

  it('el resumen detecta una fila que falta aunque los saldos no lo delaten', () => {
    // Sin la última fila: los saldos siguen cuadrando entre sí, pero no con el resumen del banco.
    const textos = extractoRevolut().filter((t) => !(t.pagina === 2 && t.y === 726));
    const { lectura, control } = leerPdfExtracto(textos, 2);
    expect(lectura && cuadrar(lectura.movimientos).estado).toBe('ok');
    expect(control?.ok).toBe(false);
  });

  it('deduce el tipo de operación del concepto y no guarda nombres de personas', () => {
    const { lectura } = leerPdfExtracto(extractoRevolut(), 2);
    const movs = lectura?.movimientos ?? [];
    const en = (i: number) => {
      const m = movs[i];
      if (!m) throw new Error(`falta el movimiento ${i}`);
      return m;
    };
    expect(movs.map((m) => m.tipoBanco)).toEqual(['TOPUP', null, 'TRANSFER', null, null, 'ATM', 'CARD_REFUND', 'EXCHANGE']);
    const persona = clasificar(en(2), new Map());
    expect(persona.limpio.comercio).toBe('Transferencia enviada');
    expect(persona.limpio.busqueda).toBe('');
    expect(clasificar(en(4), new Map()).destino).toBe('hucha');
    expect(clasificar(en(0), new Map()).destino).toBe('interno');
    expect(clasificar(en(5), new Map()).categoria).toBe('efectivo');
    expect(clasificar(en(6), new Map()).devolucion).toBe(true);
  });

  it('formato inglés con importe único con signo y fechas "Jan 2, 2026"', () => {
    const textos = [
      ...linea(1, 700, [[40, 'Date'], [140, 'Description'], [420, 'Amount', 'der'], [520, 'Balance', 'der']]),
      ...linea(1, 680, [[40, 'Jan 2, 2026'], [140, 'Lidl'], [420, '-€12.50', 'der'], [520, '€87.50', 'der']]),
      ...linea(1, 662, [[40, 'Jan 3, 2026'], [140, 'Payment from ACME SL'], [420, '€1,200.00', 'der'], [520, '€1,287.50', 'der']]),
    ];
    const { lectura } = leerPdfExtracto(textos, 1);
    expect(lectura?.movimientos.map((m) => [m.fecha, m.importe, m.saldo])).toEqual([
      ['2026-01-02', -1250, 8750],
      ['2026-01-03', 120000, 128750],
    ]);
  });

  it('PDF escaneado o sin tabla: no inventa movimientos y da un diagnóstico sin datos', () => {
    expect(leerPdfExtracto([], 3).lectura).toBeNull();
    const r = leerPdfExtracto(linea(1, 700, [[40, 'Carta de bienvenida'], [40, 'Hola']]), 1);
    expect(r.lectura).toBeNull();
    expect(r.diagnostico).toContain('columnas ninguna');
    const ok = leerPdfExtracto(extractoRevolut(), 2);
    expect(ok.diagnostico).not.toMatch(/Mercadona|Juan|45,30/);
  });
});

describe('PDF con títulos difíciles', () => {
  const resumen = [
    ...linea(1, 760, [[40, 'Revolut'], [40, 'Resumen del saldo']]),
    ...linea(1, 740, [[40, 'Producto'], [200, 'Saldo inicial', 'der'], [300, 'Dinero saliente', 'der'], [400, 'Dinero entrante', 'der'], [500, 'Saldo final', 'der']]),
    ...linea(1, 725, [[40, 'Cuenta'], [200, '100,00 €', 'der'], [300, '57,80 €', 'der'], [400, '1.200,00 €', 'der'], [500, '1.242,20 €', 'der']]),
  ];
  const filas = (y0: number) => [
    ...mov(1, y0, '2 mar 2026', 'Mercadona', '45,30 €', '', '54,70 €'),
    ...mov(1, y0 - 18, '3 mar 2026', 'Nómina', '', '1.200,00 €', '1.254,70 €'),
    ...mov(1, y0 - 36, '4 mar 2026', 'Bar Can Pep', '12,50 €', '', '1.242,20 €'),
  ];
  const importes = (r: ReturnType<typeof leerPdfExtracto>) => r.lectura?.movimientos.map((m) => m.importe);

  it('todos los títulos en un solo fragmento', () => {
    const textos = [...resumen, { texto: 'Fecha        Descripción                                   Dinero saliente     Dinero entrante              Saldo', x: 40, y: 650, ancho: 510, alto: 9, pagina: 1 }, ...filas(630)];
    const r = leerPdfExtracto(textos, 1);
    expect(importes(r)).toEqual([-4530, 120000, -1250]);
    expect(r.control?.ok).toBe(true);
  });

  it('títulos partidos en dos renglones', () => {
    const textos = [
      ...resumen,
      ...linea(1, 655, [[X.fecha, 'Fecha'], [X.desc, 'Descripción'], [X.sale, 'Dinero', 'der'], [X.entra, 'Dinero', 'der'], [X.saldo, 'Saldo', 'der']]),
      ...linea(1, 646, [[X.sale, 'saliente', 'der'], [X.entra, 'entrante', 'der']]),
      ...filas(626),
    ];
    const r = leerPdfExtracto(textos, 1);
    expect(importes(r)).toEqual([-4530, 120000, -1250]);
    expect(r.control?.ok).toBe(true);
  });

  it('sin títulos reconocibles: columnas por la alineación, verificadas con saldo y resumen', () => {
    const textos = [...resumen, ...linea(1, 650, [[X.fecha, 'Día'], [X.desc, 'Qué'], [X.sale, 'Sale', 'der'], [X.entra, 'Entra', 'der'], [X.saldo, 'Queda', 'der']]), ...filas(630)];
    const r = leerPdfExtracto(textos, 1);
    expect(importes(r)).toEqual([-4530, 120000, -1250]);
    expect(r.control?.ok).toBe(true);
    expect(r.diagnostico).toContain('Intento alineación');
  });

  it('fecha y concepto en el mismo fragmento', () => {
    const textos = [
      ...resumen,
      ...cabecera(1, 650),
      ...linea(1, 630, [[X.fecha, '2 mar 2026 Mercadona'], [X.sale, '45,30 €', 'der'], [X.saldo, '54,70 €', 'der']]),
      ...linea(1, 612, [[X.fecha, '3 mar 2026 Nómina'], [X.entra, '1.200,00 €', 'der'], [X.saldo, '1.254,70 €', 'der']]),
      ...linea(1, 594, [[X.fecha, '4 mar 2026 Bar Can Pep'], [X.sale, '12,50 €', 'der'], [X.saldo, '1.242,20 €', 'der']]),
    ];
    const r = leerPdfExtracto(textos, 1);
    expect(r.lectura?.movimientos.map((m) => [m.fecha, m.concepto])).toEqual([
      ['2026-03-02', 'Mercadona'],
      ['2026-03-03', 'Nómina'],
      ['2026-03-04', 'Bar Can Pep'],
    ]);
  });

  it('el diagnóstico muestra la estructura sin datos', () => {
    const textos = [...resumen, ...linea(1, 650, [[X.fecha, 'Día'], [X.desc, 'Qué']]), ...filas(630)];
    const d = leerPdfExtracto(textos, 1).diagnostico;
    expect(d).toContain('fecha@');
    expect(d).toContain('importe@');
    expect(d).not.toMatch(/Mercadona|Nómina|Can Pep|45,30|1\.200/);
  });
});

describe('PDF con varios productos', () => {
  it('se queda con la cadena de saldos que coincide con la cuenta del resumen', () => {
    const textos = [
      ...linea(1, 800, [[40, 'Revolut']]),
      ...linea(1, 740, [[40, 'Producto'], [200, 'Saldo inicial', 'der'], [300, 'Dinero saliente', 'der'], [400, 'Dinero entrante', 'der'], [500, 'Saldo final', 'der']]),
      ...linea(1, 725, [[40, 'Cuenta (Corriente)'], [200, '100,00 €', 'der'], [300, '57,80 €', 'der'], [400, '0,00 €', 'der'], [500, '42,20 €', 'der']]),
      ...linea(1, 710, [[40, 'Depósito a plazo'], [200, '500,00 €', 'der'], [300, '0,00 €', 'der'], [400, '1,25 €', 'der'], [500, '501,25 €', 'der']]),
      ...cabecera(1, 650),
      ...mov(1, 630, '2 mar 2026', 'Mercadona', '45,30 €', '', '54,70 €'),
      ...mov(1, 612, '4 mar 2026', 'Bar Can Pep', '12,50 €', '', '42,20 €'),
      // Otro producto sin título reconocible, con su propia secuencia de saldos.
      ...linea(1, 560, [[40, 'Producto 2']]),
      ...cabecera(1, 540),
      ...mov(1, 520, '31 mar 2026', 'Intereses', '', '1,25 €', '501,25 €'),
    ];
    const r = leerPdfExtracto(textos, 1);
    expect(r.lectura?.movimientos.map((m) => m.importe)).toEqual([-4530, -1250]);
    expect(r.control?.ok).toBe(true);
    expect(r.lectura?.descartados.some((d) => d.motivo.includes('otras cuentas'))).toBe(true);
  });
});

describe('tipo deducido del concepto', () => {
  it.each([
    ['Apple Pay top-up by *1234', 600, 'TOPUP'],
    ['Top-Up by *9876', 600, 'TOPUP'],
    ['Cash withdrawal at Caixabank', -5000, 'ATM'],
    ['Exchanged to GBP', -1000, 'EXCHANGE'],
    ['To JOHN DOE', -1000, 'TRANSFER'],
    ['Payment from ANA RUIZ', 1000, 'TRANSFER'],
    ['Premium plan fee', -799, 'FEE'],
    ['Mercadona', -1000, null],
    ['Tortilleria Toledo', -900, null],
  ] as const)('%s', (concepto, importe, tipo) => {
    expect(tipoPorConcepto(concepto, importe)).toBe(tipo);
  });
});
