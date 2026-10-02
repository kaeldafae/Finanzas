import { describe, expect, it } from 'vitest';
import { euros } from './dinero';
import {
  aplicarEscala,
  calcularIRPF,
  cuotaConMinimo,
  deduccionSueldosBajos,
  fraccionar6040,
  mensajeResultado,
  obligacionDeclarar,
  reduccionRendimientosTrabajo,
  retencionAdicionalSugerida,
  type EntradaIRPF,
} from './irpf';
import { parametrosFiscalesPorDefecto } from './parametros';

const P = parametrosFiscalesPorDefecto();

/** Tolerancia de ±0,01 € = ±1 céntimo. */
function cerca(real: number, esperadoEuros: number): void {
  expect(Math.abs(real - euros(esperadoEuros))).toBeLessThanOrEqual(1);
}

describe('caso de referencia 2026 (SEPE 9 meses + empresa 3 meses)', () => {
  const entrada: EntradaIRPF = {
    pagadores: [
      { pagadorId: 'sepe', nombre: 'SEPE', tipo: 'SEPE', bruto: 9 * euros(1050), seguridadSocial: 9 * euros(45), retencion: 0 },
      { pagadorId: 'emp', nombre: 'Hotel', tipo: 'Empresa', bruto: 3 * euros(2200), seguridadSocial: 3 * euros(143), retencion: 3 * euros(150) },
    ],
    propinas: euros(1200),
    edad: 30,
    alquilerANombre: true,
    alquilerAnual: euros(8400),
  };
  const r = calcularIRPF(entrada, P);

  it('íntegro, SS, reducción y base', () => {
    cerca(r.integro, 16050);
    cerca(r.seguridadSocial, 834);
    cerca(r.rendimientoNetoPrevio, 15216);
    cerca(r.otrosGastos, 2000);
    cerca(r.reduccion, 6665);
    cerca(r.baseLiquidable, 6551);
  });

  it('cuotas y deducción de alquiler', () => {
    cerca(r.cuotaEstatal, 95.1);
    cerca(r.cuotaAutonomica, 90.09);
    cerca(r.deduccionAlquiler, 90.09);
    cerca(r.cuotaLiquida, 95.1);
  });

  it('resultado a devolver', () => {
    cerca(r.retenciones, 450);
    cerca(r.resultado, -354.91);
    expect(r.tipoResultado).toBe('devolver');
  });

  it('obligado a declarar con 2 pagadores', () => {
    expect(r.obligacion.obligado).toBe(true);
    expect(r.obligacion.numPagadores).toBe(2);
  });

  it('las propinas no cuentan por defecto', () => {
    expect(r.propinasIncluidas).toBe(0);
    const conPropinas = calcularIRPF(entrada, { ...P, incluirPropinas: true });
    cerca(conPropinas.integro, 17250);
  });

  it('mensaje: obligado y a devolver', () => {
    const m = mensajeResultado(r, (c) => `${c}`);
    expect(m.titulo).toContain('A DEVOLVER');
  });
});

describe('reducción art. 20 LIRPF en los bordes', () => {
  const red = (rn: number) => reduccionRendimientosTrabajo(euros(rn), P.reduccion);
  it('RN = 0 → 7.302', () => cerca(red(0), 7302));
  it('RN = 14.852 → 7.302', () => cerca(red(14852), 7302));
  it('RN = 14.852,01 empieza a bajar', () => expect(red(14852.01)).toBeLessThan(euros(7302)));
  it('RN = 17.673,52 → 2.364,34 (continuo entre tramos)', () => cerca(red(17673.52), 2364.34));
  it('RN = 19.747,50 → 0', () => cerca(red(19747.5), 0));
  it('RN por encima → 0', () => expect(red(30000)).toBe(0));
});

describe('cuota con mínimo personal', () => {
  it('base menor que el mínimo → 0, nunca negativa', () => {
    expect(cuotaConMinimo(euros(3000), P.minimoPersonal, P.escalaEstatal)).toBe(0);
    expect(cuotaConMinimo(euros(3000), P.minimoPersonal, P.escalaAutonomica)).toBe(0);
    expect(cuotaConMinimo(0, P.minimoPersonal, P.escalaEstatal)).toBe(0);
  });

  it('cálculo completo con base baja: cuota líquida 0 y devuelve todo lo retenido', () => {
    const r = calcularIRPF(
      {
        pagadores: [{ pagadorId: 'a', nombre: 'A', tipo: 'Empresa', bruto: euros(9000), seguridadSocial: euros(580), retencion: euros(100) }],
        propinas: 0,
        edad: null,
        alquilerANombre: false,
        alquilerAnual: 0,
      },
      P,
    );
    expect(r.baseLiquidable).toBe(0);
    expect(r.cuotaLiquida).toBe(0);
    expect(r.resultado).toBe(-euros(100));
  });

  it('escala estatal atraviesa tramos correctamente', () => {
    // 12.450 × 9,5 % + 7.550 × 12 % = 1.182,75 + 906 = 2.088,75
    cerca(aplicarEscala(euros(20000), P.escalaEstatal), 2088.75);
  });
});

describe('obligación de declarar', () => {
  const ob = (brutos: number[]) =>
    obligacionDeclarar(
      brutos.map(euros),
      brutos.reduce((a, b) => a + euros(b), 0),
      P.obligacion,
    );
  it('1 pagador con 21.999 → NO', () => expect(ob([21999]).obligado).toBe(false));
  it('1 pagador con 22.000,01 → SÍ', () => expect(ob([22000.01]).obligado).toBe(true));
  it('2 pagadores, 2.º de 1.400, total 20.000 → NO', () => expect(ob([18600, 1400]).obligado).toBe(false));
  it('2 pagadores, 2.º de 1.600, total 16.000 → SÍ', () => expect(ob([14400, 1600]).obligado).toBe(true));
  it('el segundo pagador es el de menor importe, aunque se registre primero', () => {
    const r = ob([1600, 14400]);
    expect(r.segundoYSiguientes).toBe(euros(1600));
    expect(r.obligado).toBe(true);
  });
  it('pagadores a 0 no cuentan', () => expect(ob([16000, 0]).numPagadores).toBe(1));
});

describe('deducciones y utilidades', () => {
  it('sueldos bajos desactivada por defecto', () => {
    expect(deduccionSueldosBajos(euros(15000), P.sueldosBajos)).toBe(0);
  });
  it('sueldos bajos: tramo pleno, decreciente y fuera', () => {
    const sb = { ...P.sueldosBajos, activa: true };
    expect(deduccionSueldosBajos(euros(16576), sb)).toBe(euros(340));
    cerca(deduccionSueldosBajos(euros(17576), sb), 140);
    expect(deduccionSueldosBajos(euros(18276), sb)).toBe(0);
  });
  it('sueldos bajos no deja la cuota en negativo', () => {
    const r = calcularIRPF(
      {
        pagadores: [{ pagadorId: 'a', nombre: 'A', tipo: 'Empresa', bruto: euros(16000), seguridadSocial: euros(1000), retencion: 0 }],
        propinas: 0,
        edad: 40,
        alquilerANombre: false,
        alquilerAnual: 0,
      },
      { ...P, sueldosBajos: { ...P.sueldosBajos, activa: true } },
    );
    expect(r.cuotaLiquida).toBeGreaterThanOrEqual(0);
    expect(r.deduccionSueldosBajos).toBeLessThanOrEqual(r.cuotaEstatal + r.cuotaAutonomica);
  });
  it('alquiler: no se aplica con base por encima del máximo ni con 36 años', () => {
    const base = {
      pagadores: [{ pagadorId: 'a', nombre: 'A', tipo: 'Empresa' as const, bruto: euros(20000), seguridadSocial: euros(1270), retencion: 0 }],
      propinas: 0,
      alquilerANombre: true,
      alquilerAnual: euros(9000),
    };
    expect(calcularIRPF({ ...base, edad: 36 }, P).deduccionAlquiler).toBe(0);
    expect(calcularIRPF({ ...base, edad: 25 }, P).deduccionAlquiler).toBe(euros(650));
  });
  it('fraccionamiento 60/40 suma exacto', () => {
    const f = fraccionar6040(12345);
    expect(f.junio + f.noviembre).toBe(12345);
    expect(f.junio).toBe(7407);
  });
  it('retención adicional sugerida', () => {
    expect(retencionAdicionalSugerida(-100, euros(1000))).toBeNull();
    expect(retencionAdicionalSugerida(euros(100), 0)).toBeNull();
    // 100 / 4.400 = 2,27 % → redondeado arriba a 2,3 %
    expect(retencionAdicionalSugerida(euros(100), euros(4400))).toBe(230);
  });
});
