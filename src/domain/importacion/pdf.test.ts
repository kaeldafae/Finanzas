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
    expect(r.diagnostico).toContain('no encontrada');
    const ok = leerPdfExtracto(extractoRevolut(), 2);
    expect(ok.diagnostico).not.toMatch(/Mercadona|Juan|45,30/);
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
