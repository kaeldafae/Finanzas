import { describe, expect, it } from 'vitest';
import { deducirDecimal, leerCsv, parsearFecha, parsearImporteBanco } from './texto';

describe('CSV', () => {
  it('separador ; con comillas, comas dentro y BOM', () => {
    expect(leerCsv('﻿Fecha;Concepto;Importe\r\n01/03/2026;"Compra; ""tienda""";-12,50\r\n')).toEqual([
      ['Fecha', 'Concepto', 'Importe'],
      ['01/03/2026', 'Compra; "tienda"', '-12,50'],
    ]);
  });
  it('separador , (Revolut) y saltos de línea dentro de comillas', () => {
    expect(leerCsv('Type,Description,Amount\nCARD_PAYMENT,"Línea 1\nLínea 2",-3.5\n\n')).toEqual([
      ['Type', 'Description', 'Amount'],
      ['CARD_PAYMENT', 'Línea 1\nLínea 2', '-3.5'],
    ]);
  });
});

describe('importes con signo', () => {
  it.each([
    ['-1.234,56', ',', -123456],
    ['1.234,56', ',', 123456],
    ['12,5', ',', 1250],
    ['-12.50', '.', -1250],
    ['1,234.56', '.', 123456],
    ['(12,50)', ',', -1250],
    ['12,50 €', ',', 1250],
    ['−12,50', ',', -1250],
    ['12,50-', ',', -1250],
    ['+300', '.', 30000],
  ] as const)('%s (%s) → %i', (t, d, c) => expect(parsearImporteBanco(t, d)).toBe(c));

  it('números de Excel sin errores de coma flotante', () => {
    expect(parsearImporteBanco(-12.35, ',')).toBe(-1235);
    expect(parsearImporteBanco(0.1 + 0.2, ',')).toBe(30);
  });

  it.each([['1,234', ','], ['abc', ','], ['', ','], ['1.2.3', '.'], ['12,345', ',']] as const)('rechaza %s', (t, d) =>
    expect(parsearImporteBanco(t, d)).toBeNull(),
  );

  it('deduce el separador de una columna', () => {
    expect(deducirDecimal(['-12,50', '1.234,00', '3'])).toBe(',');
    expect(deducirDecimal(['-12.50', '1234.00'])).toBe('.');
  });
});

describe('fechas', () => {
  it.each([
    ['01/03/2026', '2026-03-01'],
    ['1-3-26', '2026-03-01'],
    ['2026-03-01 14:22:10', '2026-03-01'],
    ['31.12.2026', '2026-12-31'],
  ])('%s → %s', (t, f) => expect(parsearFecha(t)).toBe(f));
  it('fechas y números de serie de Excel', () => {
    expect(parsearFecha(new Date(Date.UTC(2026, 2, 1)))).toBe('2026-03-01');
    expect(parsearFecha(46082)).toBe('2026-03-01');
  });
  it('rechaza fechas imposibles', () => {
    expect(parsearFecha('31/02/2026')).toBeNull();
    expect(parsearFecha('hola')).toBeNull();
  });
});
