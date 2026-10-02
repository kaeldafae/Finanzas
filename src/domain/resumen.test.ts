import { describe, expect, it } from 'vitest';
import { euros } from './dinero';
import type { Gasto, Ingreso } from './modelo';
import { ajustesPorDefecto } from './parametros';
import { prepararRenta } from './renta';
import {
  estimarColchon,
  gastoMedioMensual,
  indexar,
  resumirMes,
  serieMeses,
  simularColchon,
  totalesAnio,
  type DatosFinancieros,
} from './resumen';

const hoy = { anio: 2026, mes: 6 };

function ingreso(mes: number, bruto: number, estado: Ingreso['estado'] = 'Real', pagadorId = 'emp'): Ingreso {
  const b = euros(bruto);
  return {
    id: `i${mes}${pagadorId}`,
    anio: 2026,
    mes,
    pagadorId,
    bruto: b,
    seguridadSocial: 0,
    retencionIRPF: 0,
    neto: b,
    netoManual: false,
    estado,
    nota: '',
  };
}

function gasto(mes: number, importe: number, tipo: Gasto['tipo'] = 'Fijo', categoriaId = 'alq'): Gasto {
  return { id: `g${mes}${tipo}${importe}`, anio: 2026, mes, categoriaId, importe: euros(importe), tipo, nota: '' };
}

function datos(parcial: Partial<DatosFinancieros>): DatosFinancieros {
  return {
    pagadores: [
      { id: 'emp', nombre: 'Hotel', tipo: 'Empresa', archivado: false },
      { id: 'sepe', nombre: 'SEPE', tipo: 'SEPE', archivado: false },
    ],
    categorias: [
      { id: 'alq', nombre: 'Alquiler', orden: 0, clave: 'alquiler', archivada: false },
      { id: 'com', nombre: 'Comida', orden: 1, archivada: false },
    ],
    ingresos: [],
    extras: [],
    gastos: [],
    meses: [],
    reglas: [],
    traspasos: [],
    presupuestos: [],
    importaciones: [],
    compromisos: [],
    objetivos: [],
    ...parcial,
  };
}

describe('resumen mensual', () => {
  it('mes vacío es hueco; mes confirmado sin ingresos es mes a 0', () => {
    const d = datos({ meses: [{ id: '2026-02', anio: 2026, mes: 2, confirmado: true }] });
    const i = indexar(d);
    expect(resumirMes(i, { anio: 2026, mes: 1 }, hoy).estado).toBe('vacio');
    const feb = resumirMes(i, { anio: 2026, mes: 2 }, hoy);
    expect(feb.estado).toBe('real');
    expect(feb.resultado).toBe(0);
  });

  it('propinas y extras suman al resultado del mes; los gastos restan', () => {
    const d = datos({
      ingresos: [ingreso(3, 1000)],
      extras: [{ id: 'e', anio: 2026, mes: 3, concepto: 'Propinas', importe: euros(150), nota: '' }],
      gastos: [gasto(3, 700), gasto(3, 200, 'Variable', 'com')],
    });
    const m = resumirMes(indexar(d), { anio: 2026, mes: 3 }, hoy);
    expect(m.ingresos).toBe(euros(1150));
    expect(m.gastos).toBe(euros(900));
    expect(m.resultado).toBe(euros(250));
  });

  it('meses futuros o con ingresos previstos son "previsto"', () => {
    const d = datos({ ingresos: [ingreso(5, 1000, 'Previsto'), ingreso(9, 1000)] });
    const i = indexar(d);
    expect(resumirMes(i, { anio: 2026, mes: 5 }, hoy).estado).toBe('previsto');
    expect(resumirMes(i, { anio: 2026, mes: 9 }, hoy).estado).toBe('previsto');
  });

  it('totales del año y gasto medio (solo meses reales con gasto)', () => {
    const d = datos({
      ingresos: [ingreso(1, 1000), ingreso(2, 1000)],
      gastos: [gasto(1, 600), gasto(2, 800), gasto(8, 5000)],
    });
    const serie = serieMeses(indexar(d), { anio: 2026, mes: 1 }, { anio: 2026, mes: 12 }, hoy);
    expect(serie).toHaveLength(12);
    const t = totalesAnio(serie);
    expect(t.mesesReales).toBe(2);
    expect(t.mesesPrevistos).toBe(1);
    expect(gastoMedioMensual(serie)).toBe(euros(700));
  });
});

describe('colchón', () => {
  const A = ajustesPorDefecto();
  const reglas = { incompleto: A.repartoIncompleto, completo: A.repartoCompleto };

  it('acumula desde el ahorro inicial y resta los meses negativos', () => {
    const d = datos({
      ingresos: [ingreso(1, 2000), ingreso(2, 500)],
      gastos: [gasto(1, 1000), gasto(2, 800)],
    });
    const serie = serieMeses(indexar(d), { anio: 2026, mes: 1 }, { anio: 2026, mes: 6 }, hoy);
    const objetivo = gastoMedioMensual(serie) * 6; // 900 × 6
    const sim = simularColchon(serie, euros(500), objetivo, reglas, false);
    // +700 (70 % de 1.000) y −300
    expect(sim.colchon).toBe(euros(900));
    expect(sim.pasos[1]?.aviso).toMatch(/negativo/);
    const est = estimarColchon(sim, objetivo, { anio: 2026, mes: 2 });
    expect(est.falta).toBe(euros(4500));
    // aportación media (700 − 300) / 2 = 200 → 23 meses
    expect(est.aportacionMedia).toBe(euros(200));
    expect(est.fechaEstimada).toEqual({ anio: 2028, mes: 1 });
  });

  it('sin aportación positiva no hay fecha estimada', () => {
    const d = datos({ ingresos: [ingreso(1, 100)], gastos: [gasto(1, 500)] });
    const serie = serieMeses(indexar(d), { anio: 2026, mes: 1 }, { anio: 2026, mes: 1 }, hoy);
    const sim = simularColchon(serie, 0, euros(3000), reglas, false);
    expect(estimarColchon(sim, euros(3000), { anio: 2026, mes: 1 }).fechaEstimada).toBeNull();
  });
});

describe('preparar la renta del año', () => {
  it('agrupa por pagador, toma el alquiler de los gastos y detecta meses sin registrar', () => {
    const A = { ...ajustesPorDefecto(), anioNacimiento: 1996, alquilerANombre: true };
    const d = datos({
      ingresos: [ingreso(1, 1050, 'Real', 'sepe'), ingreso(2, 1050, 'Real', 'sepe'), ingreso(7, 2200, 'Previsto')],
      gastos: [gasto(1, 700), gasto(2, 700)],
    });
    const solo = prepararRenta(d, 2026, A, false, hoy);
    expect(solo.entrada.pagadores).toHaveLength(1);
    expect(solo.entrada.alquilerAnual).toBe(euros(1400));
    expect(solo.entrada.edad).toBe(30);
    expect(solo.mesesSinRegistrar).toEqual([3, 4, 5, 6]);
    const con = prepararRenta(d, 2026, A, true, hoy);
    expect(con.entrada.pagadores).toHaveLength(2);
    expect(con.brutoPendienteEmpresa).toBe(euros(2200));
    expect(prepararRenta(d, 2026, { ...A, alquilerAnualManual: euros(8400) }, false, hoy).entrada.alquilerAnual).toBe(euros(8400));
  });
});
