import { describe, expect, it } from 'vitest';
import type { Categoria } from '../modelo';
import { comprobarConservacion, analizarCoherencia } from './analisis';
import { consenso, crearPeticion, itemsDudosos, leerRespuesta, MARCA_RESPUESTA, type ItemIA } from './ia';
import { construirFilas, type Decision, type MovimientoPropuesto } from './importar';

const categorias: Categoria[] = [
  { id: 'c-hogar', nombre: 'Hogar', orden: 0, archivada: false, clave: 'hogar' },
  { id: 'c-otros', nombre: 'Otros', orden: 1, archivada: false, clave: 'otros' },
  { id: 'c-rest', nombre: 'Restaurantes y bares', orden: 2, archivada: false, clave: 'restaurantes' },
  { id: 'c-pers', nombre: 'Personas (Bizum y transferencias)', orden: 3, archivada: false, clave: 'personas' },
];
const nombre = (id: string) => categorias.find((c) => c.id === id)?.nombre ?? id;

function mov(id: string, comercio: string, importe: number, extra: Partial<MovimientoPropuesto['propuesta']> = {}): MovimientoPropuesto {
  return {
    id, cuenta: 'Revolut', fecha: '2026-03-02', anio: 2026, mes: 3, importe, concepto: `COMPRA ${comercio} 5540XXXX1234 JUAN PEREZ`, duplicado: false, pareja: null, recurrente: false,
    propuesta: { destino: 'gasto', categoria: 'otros', categoriaId: null, tipoGasto: 'Variable', pagador: null, devolucion: false, confianza: 0.3, motivo: '', limpio: { comercio, clave: comercio.toLowerCase().split(' ')[0] ?? '', busqueda: comercio.toLowerCase(), persona: null }, ...extra },
  };
}
const dec = (categoriaId: string | null = 'c-otros'): Decision => ({ incluir: true, destino: 'gasto', categoriaId, tipoGasto: 'Variable', pagadorId: null, conceptoExtra: 'Otro', recordar: false });

const movs = [
  mov('a1', 'Amzn Mktp Es', -1999),
  mov('a2', 'Amzn Mktp Es', -4500),
  mov('b1', 'Braseria Can Pep', -3200),
  mov('p1', 'Bizum enviado', -1500, { limpio: { comercio: 'Bizum enviado', clave: '', busqueda: '', persona: 'bizum' } }),
];
const decisiones = new Map(movs.map((m) => [m.id, dec()]));

describe('revisión con IA por copiar y pegar', () => {
  const items = itemsDudosos(movs, decisiones, () => true);

  it('agrupa por comercio y nunca incluye Bizum, importes exactos, fechas ni datos del concepto', () => {
    expect(items.map((i) => [i.n, i.comercio, i.veces])).toEqual([[1, 'Amzn Mktp Es', 2], [2, 'Braseria Can Pep', 1]]);
    for (const v of [1, 2] as const) {
      const p = crearPeticion(items, categorias, v);
      expect(p).not.toMatch(/Bizum|19,99|45|2026|5540|JUAN|PEREZ|Revolut/);
      expect(p).toContain('Hogar');
      expect(p).not.toContain('Personas');
      expect(p).toContain(MARCA_RESPUESTA);
    }
  });

  it('la segunda petición cambia redacción y orden pero conserva los números', () => {
    const muchos: ItemIA[] = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, comercio: `Comercio ${i + 1}`, veces: 1, rango: 'menos de 10 €', sentido: 'gasto', ids: [] }));
    const p1 = crearPeticion(muchos, categorias, 1);
    const p2 = crearPeticion(muchos, categorias, 2);
    expect(p1).not.toBe(p2);
    for (const it of muchos) expect(p2).toContain(`${it.n}. Comercio ${it.n} `);
    expect(p2.indexOf('1. Comercio 1')).not.toBe(p1.indexOf('1. Comercio 1'));
  });

  it('lee la respuesta con texto alrededor, valida categorías y números, e informa de lo que falta', () => {
    const texto = `Claro, aquí tienes:\n${MARCA_RESPUESTA}\n[{"n":1,"categoria":"hogar","tipo":"Variable","seguridad":"media","motivo":"tienda online"},{"n":7,"categoria":"Hogar"},{"n":2,"categoria":"Viajes"}]\nEspero que ayude`;
    const r = leerRespuesta(texto, items, categorias);
    expect(r.propuestas.get(1)?.categoriaId).toBe('c-hogar');
    expect(r.propuestas.size).toBe(1);
    expect(r.errores.join(' ')).toMatch(/7 no está/);
    expect(r.errores.join(' ')).toMatch(/Viajes.*no existe/);
    expect(r.errores.join(' ')).toMatch(/Sin respuesta válida para: 2/);
  });

  it('respuesta cortada o basura → error claro y nada aplicado', () => {
    expect(leerRespuesta('[{"n":1,"categoria":"Hogar"', items, categorias)).toMatchObject({ propuestas: new Map(), errores: [expect.stringMatching(/incompleta/)] });
    expect(leerRespuesta('[{"n":1,"categoria":"Hogar"}, {"n":2', items, categorias).errores[0]).toMatch(/incompleta/);
    expect(leerRespuesta('hola', items, categorias).propuestas.size).toBe(0);
  });

  it('consenso: solo propone cuando las dos revisiones coinciden con seguridad y no contradicen a la app', () => {
    const p = (categoriaId: string, seguridad: 'alta' | 'media' | 'baja' = 'alta') => ({ categoriaId, tipo: 'Variable' as const, seguridad, motivo: '' });
    const lista: ItemIA[] = [1, 2, 3, 4].map((n) => ({ n, comercio: `C${n}`, veces: 1, rango: 'menos de 10 €', sentido: 'gasto', ids: [] }));
    const r1 = new Map([[1, p('c-hogar')], [2, p('c-hogar')], [3, p('c-rest', 'baja')], [4, p('c-hogar')]]);
    const r2 = new Map([[1, p('c-hogar')], [2, p('c-rest')], [3, p('c-rest', 'alta')], [4, p('c-hogar')]]);
    const app = (it: ItemIA) => (it.n === 4 ? { categoriaId: 'c-rest', segura: true } : { categoriaId: null, segura: false });
    const c = consenso(lista, r1, r2, app, nombre);
    expect(c.map((x) => x.estado)).toEqual(['coinciden', 'discrepan', 'baja-seguridad', 'contradice-diccionario']);
    expect(c.map((x) => x.categoriaId)).toEqual(['c-hogar', null, null, null]);
    expect(consenso(lista.slice(0, 1), r1, null, app, nombre)[0]?.estado).toBe('una-revision');
  });
});

describe('comprobaciones antes de guardar', () => {
  it('conservación: cada céntimo incluido acaba en una fila', () => {
    const d = new Map(decisiones);
    d.set('p1', { ...dec('c-pers') });
    const filas = construirFilas(movs, d, (() => { let n = 0; return () => `id${n++}`; })());
    const c = comprobarConservacion(movs, d, filas);
    expect(c.ok).toBe(true);
    expect(c.totalMovimientos).toBe(-11199);
    // Si se pierde una fila, se detecta.
    expect(comprobarConservacion(movs, d, { ...filas, gastos: filas.gastos.slice(1) }).ok).toBe(false);
  });

  it('avisa de comercio en dos categorías, importes raros y fijos que no se repiten', () => {
    const d = new Map(decisiones);
    d.set('a2', dec('c-hogar'));
    d.set('b1', { ...dec('c-rest'), tipoGasto: 'Fijo' });
    const caro = mov('b2', 'Taberna X', -60000);
    d.set('b2', { ...dec('c-rest'), tipoGasto: 'Fijo' });
    const historico = Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, anio: 2026, mes: 1, categoriaId: 'c-rest', importe: 2500, tipo: 'Variable' as const, nota: '' }));
    const avisos = analizarCoherencia([...movs, caro], d, historico, nombre);
    expect(avisos.map((a) => a.tipo).sort()).toEqual(['comercio-dividido', 'fijo-puntual', 'importe-raro']);
  });
});
