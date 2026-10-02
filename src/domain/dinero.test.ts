import { describe, expect, it } from 'vitest';
import {
  aplicarTasa,
  centimosATexto,
  coeficienteATexto,
  dividirRedondeando,
  formatearEuros,
  parsearCoeficiente,
  parsearEuros,
  parsearPorcentaje,
  tasaATexto,
} from './dinero';

const valor = (r: ReturnType<typeof parsearEuros>) => (r.ok ? r.valor : r.error);

describe('parseo de importes en formato español', () => {
  it.each([
    ['1234,56', 123456],
    ['1.234,56', 123456],
    ['1234.56', 123456],
    ['2.200', 220000],
    ['12', 1200],
    ['0,5', 50],
    [' 1 050 € ', 105000],
    ['1.234.567,8', 123456780],
    ['7,', 700],
  ])('%s → %i céntimos', (t, c) => expect(valor(parsearEuros(t))).toBe(c));

  // "1,234" se rechaza: con coma decimal solo caben 2 decimales, y no adivinamos si era un millar.
  it.each(['', 'abc', '-5', '1,2,3', '1,234', '12,345', '1.2.3', '99999999999'])('rechaza "%s"', (t) => {
    expect(parsearEuros(t).ok).toBe(false);
  });

  it('porcentajes y coeficientes', () => {
    expect(valor(parsearPorcentaje('9,5'))).toBe(950);
    expect(valor(parsearPorcentaje('100'))).toBe(10000);
    expect(parsearPorcentaje('100,01').ok).toBe(false);
    expect(valor(parsearCoeficiente('1,75'))).toBe(17500);
    expect(tasaATexto(1125)).toBe('11,25');
    expect(tasaATexto(900)).toBe('9');
    expect(coeficienteATexto(11400)).toBe('1,14');
  });
});

describe('aritmética entera', () => {
  it('redondeo comercial simétrico', () => {
    expect(dividirRedondeando(5, 10)).toBe(1);
    expect(dividirRedondeando(4, 10)).toBe(0);
    expect(dividirRedondeando(-5, 10)).toBe(-1);
    expect(dividirRedondeando(-4, 10)).toBe(0);
  });
  it('aplicar tasa: 1.001 € × 9,5 % = 95,10 € (no 95,09 por error de float)', () => {
    expect(aplicarTasa(100100, 950)).toBe(9510);
  });
  it('formato', () => {
    // es-ES no agrupa miles con 4 cifras; el espacio antes de € es no separable.
    expect(formatearEuros(123456).replace(/\s/g, ' ')).toBe('1234,56 €');
    expect(formatearEuros(1234567).replace(/\s/g, ' ')).toBe('12.345,67 €');
    expect(centimosATexto(123456)).toBe('1234,56');
    expect(centimosATexto(1200)).toBe('12');
    expect(centimosATexto(105)).toBe('1,05');
  });
});
