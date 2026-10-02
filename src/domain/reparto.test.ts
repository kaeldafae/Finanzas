import { describe, expect, it } from 'vitest';
import { euros } from './dinero';
import { repartirPorPorcentajes, repartirResultado, validarPorcentajes } from './reparto';
import { ajustesPorDefecto } from './parametros';

const A = ajustesPorDefecto();
const reglas = { incompleto: A.repartoIncompleto, completo: A.repartoCompleto };

describe('reparto del resultado', () => {
  it('resultado negativo: no se reparte y se resta del colchón', () => {
    const r = repartirResultado(-euros(250), euros(1000), euros(6000), reglas);
    expect(r.reparto).toEqual({ colchon: -euros(250), inversion: 0, objetivos: 0, libre: 0 });
    expect(r.aviso).toMatch(/negativo/);
  });

  it('colchón incompleto: 70 % colchón / 30 % libre', () => {
    const r = repartirResultado(euros(1000), 0, euros(6000), reglas);
    expect(r.reparto).toEqual({ colchon: euros(700), inversion: 0, objetivos: 0, libre: euros(300) });
  });

  it('colchón completo: 50 inversión / 20 objetivos / 30 libre', () => {
    const r = repartirResultado(euros(1000), euros(6000), euros(6000), reglas);
    expect(r.reparto).toEqual({ colchon: 0, inversion: euros(500), objetivos: euros(200), libre: euros(300) });
  });

  it('el mes que completa el colchón no se pasa del objetivo', () => {
    const r = repartirResultado(euros(1000), euros(5800), euros(6000), reglas);
    expect(r.completaColchon).toBe(true);
    expect(r.reparto.colchon).toBe(euros(200));
    // 800 restantes → 400 / 160 / 240
    expect(r.reparto).toEqual({ colchon: euros(200), inversion: euros(400), objetivos: euros(160), libre: euros(240) });
  });

  it('nunca pierde céntimos', () => {
    for (const importe of [1, 2, 3, 7, 99, 101, 12345, 99999]) {
      const r = repartirPorPorcentajes(importe, { colchon: 3333, inversion: 3333, objetivos: 3334, libre: 0 });
      expect(r.colchon + r.inversion + r.objetivos + r.libre).toBe(importe);
    }
  });

  it('porcentajes que no suman 100 % se rechazan', () => {
    const malos = { colchon: 7000, inversion: 0, objetivos: 0, libre: 2000 };
    expect(validarPorcentajes(malos)).toMatch(/90/);
    expect(() => repartirResultado(euros(100), 0, euros(1000), { ...reglas, incompleto: malos })).toThrow(RangeError);
    expect(validarPorcentajes({ colchon: -1, inversion: 5001, objetivos: 0, libre: 5000 })).not.toBeNull();
    expect(validarPorcentajes(A.repartoCompleto)).toBeNull();
  });
});
