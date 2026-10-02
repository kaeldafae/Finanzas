import type { Centimos } from './dinero';
import type { ResultadoIRPF } from './irpf';
import { importeGasto, nombreMes } from './modelo';
import type { DatosFinancieros, ResumenMes } from './resumen';

/** Celda neutra: el módulo de escritura decide el formato. Los importes van en euros como número. */
export type CeldaExcel = string | number | null;
export interface HojaExcel {
  nombre: string;
  filas: CeldaExcel[][];
  anchos: number[];
  /** Índices de columnas con importes (formato moneda). */
  columnasImporte: number[];
}

/** Para Excel sí se pasa a euros: es el formato de salida, no se opera con ello. */
const e = (c: Centimos): number => c / 100;

export function hojasAnio(anio: number, d: DatosFinancieros, meses: readonly ResumenMes[], renta: ResultadoIRPF | null): HojaExcel[] {
  const resumen: HojaExcel = {
    nombre: `Resumen ${anio}`,
    anchos: [12, 12, 14, 12, 12, 12, 12, 14],
    columnasImporte: [2, 3, 4, 5, 6, 7],
    filas: [
      ['Mes', 'Estado', 'Ingresos', 'Propinas', 'Otros', 'Gastos', 'Fijos', 'Resultado'],
      ...meses.map((m) => [
        nombreMes(m.mes),
        m.estado === 'vacio' ? 'Sin registrar' : m.estado === 'previsto' ? 'Previsto' : 'Real',
        e(m.ingresos),
        e(m.propinas),
        e(m.otrosExtras),
        e(m.gastos),
        e(m.gastosFijos),
        e(m.resultado),
      ]),
      [
        'Total',
        '',
        e(meses.reduce((s, m) => s + m.ingresos, 0)),
        e(meses.reduce((s, m) => s + m.propinas, 0)),
        e(meses.reduce((s, m) => s + m.otrosExtras, 0)),
        e(meses.reduce((s, m) => s + m.gastos, 0)),
        e(meses.reduce((s, m) => s + m.gastosFijos, 0)),
        e(meses.reduce((s, m) => s + m.resultado, 0)),
      ],
    ],
  };

  const pagador = (id: string) => d.pagadores.find((p) => p.id === id)?.nombre ?? '';
  const categoria = (id: string) => d.categorias.find((c) => c.id === id)?.nombre ?? '';
  const ingresos: HojaExcel = {
    nombre: 'Ingresos',
    anchos: [12, 22, 10, 12, 12, 12, 12, 30],
    columnasImporte: [3, 4, 5, 6],
    filas: [
      ['Mes', 'Pagador', 'Estado', 'Bruto', 'Seg. Social', 'Retención', 'Neto', 'Nota'],
      ...d.ingresos
        .filter((i) => i.anio === anio)
        .sort((a, b) => a.mes - b.mes)
        .map((i) => [nombreMes(i.mes), pagador(i.pagadorId), i.estado, e(i.bruto), e(i.seguridadSocial), e(i.retencionIRPF), e(i.neto), i.nota]),
      ...d.extras
        .filter((x) => x.anio === anio)
        .sort((a, b) => a.mes - b.mes)
        .map((x) => [nombreMes(x.mes), x.concepto, 'Real', null, null, null, e(x.importe), x.nota]),
    ],
  };

  const gastos: HojaExcel = {
    nombre: 'Gastos',
    anchos: [12, 20, 10, 12, 30],
    columnasImporte: [3],
    filas: [
      ['Mes', 'Categoría', 'Tipo', 'Importe', 'Nota'],
      ...d.gastos
        .filter((g) => g.anio === anio)
        .sort((a, b) => a.mes - b.mes)
        .map((g) => [nombreMes(g.mes), categoria(g.categoriaId), g.tipo, e(importeGasto(g)), g.comercio ?? g.nota]),
    ],
  };

  const hojas = [resumen, ingresos, gastos];
  if (renta) {
    hojas.push({
      nombre: 'Renta (estimación)',
      anchos: [44, 14],
      columnasImporte: [1],
      filas: [
        ['Concepto', 'Importe'],
        ['Rendimiento íntegro', e(renta.integro)],
        ['Seguridad Social', e(renta.seguridadSocial)],
        ['Rendimiento neto previo', e(renta.rendimientoNetoPrevio)],
        ['Otros gastos deducibles', e(renta.otrosGastos)],
        ['Reducción art. 20', e(renta.reduccion)],
        ['Base liquidable', e(renta.baseLiquidable)],
        ['Cuota estatal', e(renta.cuotaEstatal)],
        ['Cuota autonómica', e(renta.cuotaAutonomica)],
        ['Deducción alquiler', e(renta.deduccionAlquiler)],
        ['Deducción rendimientos bajos', e(renta.deduccionSueldosBajos)],
        ['Cuota líquida', e(renta.cuotaLiquida)],
        ['Retenciones', e(renta.retenciones)],
        ['Resultado (+ pagar / − devolver)', e(renta.resultado)],
        ['Obligado a declarar', renta.obligacion.obligado ? 'Sí' : 'No'],
        ['Estimación orientativa: la cifra oficial es la del borrador de la AEAT.', null],
      ],
    });
  }
  return hojas;
}
