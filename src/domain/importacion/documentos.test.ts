import { describe, expect, it } from 'vitest';
import { cuadrar } from './cuadre';
import { tipoDocumento } from './documento';
import { leerNomina } from './nomina';
import type { TextoPdf } from './pdf';
import { filasDeTexto, leerTextoPegado } from './textoPegado';

function linea(y: number, celdas: readonly (readonly [number, string])[]): TextoPdf[] {
  return celdas.map(([x, texto]) => ({ texto, x, y, ancho: texto.length * 4.6, alto: 9, pagina: 1 }));
}

/** Nómina con la estructura del modelo oficial de recibo de salarios. */
function nomina(liquido = '1.508,95'): TextoPdf[] {
  return [
    ...linea(800, [[40, 'RECIBO INDIVIDUAL JUSTIFICATIVO DEL PAGO DE SALARIOS']]),
    ...linea(780, [[40, 'Empresa: HOTELES IBIZA SL'], [300, 'Periodo de liquidación: del 01/05/2026 al 31/05/2026']]),
    ...linea(740, [[40, 'I. DEVENGOS'], [480, 'TOTALES']]),
    ...linea(725, [[40, 'Salario base'], [480, '1.400,00']]),
    ...linea(712, [[40, 'Plus de transporte'], [480, '450,00']]),
    ...linea(690, [[40, 'A. TOTAL DEVENGADO'], [480, '1.850,00']]),
    ...linea(670, [[40, 'II. DEDUCCIONES']]),
    ...linea(655, [[40, 'Contingencias comunes'], [300, '1.850,00'], [380, '4,70'], [480, '86,95']]),
    ...linea(642, [[40, 'Desempleo'], [300, '1.850,00'], [380, '1,55'], [480, '28,68']]),
    ...linea(629, [[40, 'Formación profesional'], [300, '1.850,00'], [380, '0,10'], [480, '1,85']]),
    ...linea(616, [[40, 'MEI'], [300, '1.850,00'], [380, '0,13'], [480, '2,57']]),
    ...linea(600, [[40, 'Impuesto sobre la renta de las personas físicas'], [300, '1.850,00'], [380, '12,00'], [480, '221,00']]),
    ...linea(580, [[40, 'B. TOTAL A DEDUCIR'], [480, '341,05']]),
    ...linea(560, [[40, 'LÍQUIDO TOTAL A PERCIBIR (A - B)'], [480, liquido]]),
    // Aportación de la empresa: no son deducciones del trabajador.
    ...linea(500, [[40, 'DETERMINACIÓN DE LAS BASES DE COTIZACIÓN Y APORTACIÓN DE LA EMPRESA']]),
    ...linea(480, [[40, 'Contingencias comunes'], [300, '1.850,00'], [380, '23,60'], [480, '436,60']]),
    ...linea(467, [[40, 'Desempleo'], [300, '1.850,00'], [380, '5,50'], [480, '101,75']]),
  ];
}

describe('nóminas', () => {
  it('lee devengado, cotizaciones del trabajador, IRPF y líquido; el periodo y cuadra al céntimo', () => {
    const r = leerNomina(nomina());
    expect(r).toEqual({
      ok: true,
      nomina: { bruto: 185000, seguridadSocial: 12005, irpf: 22100, otrasDeducciones: 0, neto: 150895, periodo: { anio: 2026, mes: 5 }, avisos: [] },
    });
  });

  it('si los totales no cuadran, no se importa', () => {
    const r = leerNomina(nomina('1.510,00'));
    expect(r.ok).toBe(false);
  });

  it('el clasificador distingue nómina, extracto y factura', () => {
    const texto = (t: TextoPdf[]) => t.map((x) => x.texto).join('\n');
    expect(tipoDocumento(texto(nomina()))).toBe('nomina');
    expect(tipoDocumento('Revolut Extracto en EUR\nFecha Descripción Dinero saliente Dinero entrante Saldo')).toBe('extracto');
    expect(tipoDocumento('FACTURA Nº de factura 2026/15 Base imponible 100,00 IVA 21 % Total factura 121,00')).toBe('factura');
    expect(tipoDocumento('Carta de bienvenida')).toBe('desconocido');
  });
});

describe('texto pegado', () => {
  it('líneas con fecha, concepto, importe y saldo: verificado con el saldo', () => {
    const t = `01/03/2026 Mercadona -45,30 554,70
02/03/2026 Nomina Hoteles 1.200,00 1.754,70
03/03/2026 Bar Can Pep -12,50 € 1.742,20 €`;
    const l = leerTextoPegado(t, '2026-04-01');
    expect(l?.deteccion).toBe('texto');
    expect(l?.movimientos.map((m) => [m.fecha, m.concepto, m.importe])).toEqual([
      ['2026-03-01', 'Mercadona', -4530],
      ['2026-03-02', 'Nomina Hoteles', 120000],
      ['2026-03-03', 'Bar Can Pep', -1250],
    ]);
    expect(l && cuadrar(l.movimientos).estado).toBe('ok');
  });

  it('listas de app agrupadas por día, sin año y con el importe en otra línea', () => {
    const t = `3 de marzo
Mercadona
-45,30 €
Taberna Sa Punta -38,00 €
5 mar
Recarga de *1234 +600,00 €`;
    expect(filasDeTexto(t, '2026-04-01')).toEqual([
      ['2026-03-03', 'Mercadona', '-45,30 €', null],
      ['2026-03-03', 'Taberna Sa Punta', '-38,00 €', null],
      ['2026-03-05', 'Recarga de *1234', '+600,00 €', null],
    ]);
    // Una fecha sin año posterior a hoy es del año anterior.
    expect(filasDeTexto('20 dic\nCena -30,00', '2026-04-01')[0]?.[0]).toBe('2025-12-20');
  });
});
