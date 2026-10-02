import { describe, expect, it } from 'vitest';
import { euros } from './dinero';
import { costeMensual, detectarCompromisos, proximosCargos } from './compromisos';
import type { Categoria, Compromiso, Gasto, Ingreso } from './modelo';
import { escenariosAhorro, estadoObjetivo } from './objetivos';
import { prever } from './prevision';
import { indexar, serieMeses, type DatosFinancieros } from './resumen';
import { variacionesMes } from './variaciones';

const categorias: Categoria[] = [
  { id: 'alq', nombre: 'Alquiler', orden: 0, clave: 'alquiler', archivada: false },
  { id: 'sus', nombre: 'Suscripciones', orden: 1, clave: 'suscripciones', archivada: false },
  { id: 'res', nombre: 'Restaurantes y bares', orden: 2, clave: 'restaurantes', archivada: false },
  { id: 'com', nombre: 'Comida', orden: 3, clave: 'comida', archivada: false },
  { id: 'fee', nombre: 'Comisiones bancarias', orden: 4, clave: 'comisiones', archivada: false },
];

let n = 0;
function gasto(anio: number, mes: number, cat: string, importe: number, extra: Partial<Gasto> = {}): Gasto {
  return { id: `g${n++}`, anio, mes, categoriaId: cat, importe: euros(importe), tipo: 'Variable', nota: '', ...extra };
}
function ingreso(anio: number, mes: number, neto: number, estado: Ingreso['estado'] = 'Real'): Ingreso {
  return { id: `i${n++}`, anio, mes, pagadorId: 'emp', bruto: euros(neto), seguridadSocial: 0, retencionIRPF: 0, neto: euros(neto), netoManual: false, estado, nota: '' };
}
function datos(p: Partial<DatosFinancieros>): DatosFinancieros {
  return {
    pagadores: [{ id: 'emp', nombre: 'Hotel', tipo: 'Empresa', archivado: false }],
    categorias, ingresos: [], extras: [], gastos: [], meses: [], reglas: [], traspasos: [], presupuestos: [], importaciones: [], compromisos: [], objetivos: [],
    ...p,
  };
}

describe('pagos recurrentes', () => {
  it('detecta mensuales y anuales estables; ignora compras frecuentes y lo que ya no se cobra', () => {
    const gastos = [
      ...[1, 2, 3, 4].map((m) => gasto(2026, m, 'sus', 12.99, { comercio: 'Netflix.com' })),
      ...[1, 2, 3, 4].map((m) => gasto(2026, m, 'alq', 650, { tipo: 'Fijo', nota: 'Alquiler piso' })),
      gasto(2025, 3, 'sus', 69, { comercio: 'Amazon Prime' }),
      gasto(2026, 3, 'sus', 69, { comercio: 'Amazon Prime' }),
      // Supermercado: muchas compras al mes, no es un compromiso.
      ...[1, 2, 3, 4].flatMap((m) => [gasto(2026, m, 'com', 40, { comercio: 'Mercadona' }), gasto(2026, m, 'com', 45, { comercio: 'Mercadona' })]),
      // Gimnasio que dejó de cobrarse hace meses.
      ...[1, 2, 3].map((m) => gasto(2025, m, 'sus', 30, { comercio: 'Basic Fit' })),
      // Importe que varía demasiado.
      ...[1, 2, 3, 4].map((m) => gasto(2026, m, 'res', 20 * m, { comercio: 'Bar Can Pep' })),
    ];
    const s = detectarCompromisos(gastos, [], { anio: 2026, mes: 4 });
    expect(s.map((x) => [x.nombre, x.periodicidad, x.importe])).toEqual([
      ['Alquiler piso', 'mensual', 65000],
      ['Amazon Prime', 'anual', 6900],
      ['Netflix.com', 'mensual', 1299],
    ]);
    // Lo ya guardado no se vuelve a sugerir.
    const guardado: Compromiso = { id: 'c', nombre: 'netflix.com', categoriaId: 'sus', importe: 1299, periodicidad: 'mensual', ultimoAnio: 2026, ultimoMes: 4, activo: true, origen: 'detectado' };
    expect(detectarCompromisos(gastos, [guardado], { anio: 2026, mes: 4 }).some((x) => x.nombre === 'Netflix.com')).toBe(false);
  });

  it('próximos cargos y coste mensual', () => {
    const c = { periodicidad: 'trimestral' as const, ultimoAnio: 2026, ultimoMes: 2, importe: 9000 };
    expect(proximosCargos(c, { anio: 2026, mes: 3 }, { anio: 2026, mes: 12 })).toEqual([
      { anio: 2026, mes: 5 }, { anio: 2026, mes: 8 }, { anio: 2026, mes: 11 },
    ]);
    expect(costeMensual(c)).toBe(3000);
  });
});

describe('previsión', () => {
  const hoy = { anio: 2026, mes: 4 };
  const base = () => {
    const ingresos = [
      // Año anterior: temporada en verano.
      ingreso(2025, 5, 1800), ingreso(2025, 6, 2000), ingreso(2025, 7, 2100),
      ...[1, 2, 3, 4].map((m) => ingreso(2026, m, 900)),
    ];
    const gastos = [
      ...[5, 6, 7].map((m) => gasto(2025, m, 'res', 300)),
      ...[1, 2, 3, 4].flatMap((m) => [gasto(2026, m, 'alq', 650, { tipo: 'Fijo' }), gasto(2026, m, 'res', 200)]),
    ];
    return datos({ ingresos, gastos });
  };
  const ejecutar = (d: DatosFinancieros, dias = 90, simulacion?: { menosGastoMensual: number; masIngresoMensual: number }) => {
    const indice = indexar(d);
    const serie = serieMeses(indice, { anio: 2025, mes: 1 }, { anio: 2026, mes: 12 }, hoy);
    return prever({ datos: d, indice, serie, saldoActual: euros(1000), hoy, dias, ...(simulacion ? { simulacion } : {}) });
  };

  it('usa el mismo mes del año anterior (temporada) y lo dice', () => {
    const p = ejecutar(base());
    expect(p.meses.map((m) => [m.mes, m.ingresos])).toEqual([[5, 180000], [6, 200000], [7, 210000]]);
    expect(p.meses[0]?.lineas.find((l) => l.concepto === 'Ingresos')?.detalle).toBe('Como en mayo 2025');
    expect(p.meses[0]?.confianza).toBe('media');
    expect(p.supuestos.join(' ')).toContain('temporada');
  });

  it('lo planificado manda y los pagos recurrentes no se cuentan dos veces', () => {
    const d = base();
    d.ingresos.push(ingreso(2026, 5, 1500, 'Previsto'));
    d.compromisos.push({ id: 'c', nombre: 'Alquiler', categoriaId: 'alq', importe: euros(650), periodicidad: 'mensual', ultimoAnio: 2026, ultimoMes: 4, activo: true, origen: 'manual' });
    const mayo = ejecutar(d, 30).meses[0];
    expect(mayo?.lineas.map((l) => [l.concepto, l.importe, l.origen])).toEqual([
      ['Ingresos previstos', 150000, 'planificado'],
      ['Alquiler', -65000, 'planificado'],
      // Mayo 2025 sin el alquiler (categoría comprometida): solo restaurantes.
      ['Gasto variable', -30000, 'estimado'],
    ]);
    expect(mayo?.saldoFinal).toBe(euros(1000 + 1500 - 650 - 300));
  });

  it('la simulación va aparte y el mínimo de saldo se detecta', () => {
    const p = ejecutar(base(), 90, { menosGastoMensual: euros(100), masIngresoMensual: 0 });
    expect(p.meses.every((m) => m.lineas.some((l) => l.origen === 'simulado' && l.importe === 10000))).toBe(true);
    // Ingresos y gastos no incluyen la simulación; el resultado sí.
    const m = p.meses[0];
    expect(m && m.resultado - (m.ingresos - m.gastos)).toBe(10000);
    expect(p.minimo.saldo).toBeLessThanOrEqual(p.saldoInicial);
  });
});

describe('objetivos de ahorro', () => {
  it('progreso, fecha estimada y aportación necesaria', () => {
    const e = estadoObjetivo({ importeObjetivo: euros(1200), importeActual: euros(300), aportacionMensual: euros(100), fechaObjetivo: '2026-10' }, { anio: 2026, mes: 4 });
    expect(e).toEqual({ falta: 90000, progreso: 2500, completo: false, fechaEstimada: { anio: 2027, mes: 1 }, aportacionNecesaria: 15000, mesesRestantes: 6 });
  });

  it('escenarios de 100, 200 y 300 €', () => {
    expect(escenariosAhorro(euros(1000), [euros(100), euros(200), euros(300)], { anio: 2026, mes: 4 }).map((x) => [x.meses, x.fecha])).toEqual([
      [10, { anio: 2027, mes: 2 }],
      [5, { anio: 2026, mes: 9 }],
      [4, { anio: 2026, mes: 8 }],
    ]);
  });
});

describe('variaciones de gasto', () => {
  it('describe subidas, gastos inusuales y comisiones frente a tu mediana', () => {
    const gastos = [
      ...[1, 2, 3, 4].flatMap((m) => [gasto(2026, m, 'res', 100), gasto(2026, m, 'com', 50)]),
      gasto(2026, 5, 'res', 140),
      gasto(2026, 5, 'com', 200),
      gasto(2026, 5, 'fee', 3),
    ];
    const v = variacionesMes(indexar(datos({ gastos })), categorias, { anio: 2026, mes: 5 });
    expect(v.map((x) => x.tipo)).toEqual(['subida', 'subida', 'inusual', 'comisiones']);
    expect(v[0]?.texto.replace(/\s/g, ' ')).toBe('Comida: 200,00 € este mes, un 300 % más que tu mediana de los 4 meses anteriores (50,00 €).');
    expect(v.find((x) => x.tipo === 'comisiones')?.texto.replace(/\s/g, ' ')).toBe('Comisiones bancarias este mes: 3,00 €.');
  });

  it('sin historia suficiente no compara', () => {
    expect(variacionesMes(indexar(datos({ gastos: [gasto(2026, 1, 'res', 10), gasto(2026, 2, 'res', 100)] })), categorias, { anio: 2026, mes: 2 })).toEqual([]);
  });
});
