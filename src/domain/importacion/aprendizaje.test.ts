import { describe, expect, it } from 'vitest';
import { ejemplosDeEntrenamiento, entrenar, sugerencia } from './aprendizaje';

const categoria = (clave: string) => `cat-${clave}`;

describe('aprendizaje local', () => {
  const modeloBase = entrenar(ejemplosDeEntrenamiento(categoria, []));

  it('reconoce palabras conocidas aunque no estén al principio', () => {
    expect(sugerencia(modeloBase, 'Ibiza Gran Hotel')?.etiqueta).toBe('cat-viajes');
    expect(sugerencia(modeloBase, 'Vara de Rey Farmacia')?.etiqueta).toBe('cat-salud');
  });

  it('no inventa nada sin pistas: mejor "no sé" que una categoría equivocada', () => {
    expect(sugerencia(modeloBase, 'XKCD 334')).toBeNull();
    expect(sugerencia(modeloBase, 'Zwq Holdings')).toBeNull();
    expect(sugerencia(modeloBase, 'Quimera Unica')).toBeNull();
    // Terminación "-eria" sin palabra conocida: no se adivina.
    expect(sugerencia(modeloBase, 'Braseria Can Pep')).toBeNull();
  });

  it('aprende de tus clasificaciones y reconoce variantes del mismo comercio', () => {
    const tuyos = [
      { comercio: 'Gym Ibiza Fitness', categoriaId: 'cat-ocio' },
      { comercio: 'Can Toni Frutas', categoriaId: 'cat-comida' },
      { comercio: 'Tattoo Studio Blue', categoriaId: 'cat-ropa' },
    ];
    const m = entrenar(ejemplosDeEntrenamiento(categoria, tuyos));
    expect(sugerencia(m, 'IBIZA FITNESS CENTER')?.etiqueta).toBe('cat-ocio');
    expect(sugerencia(m, 'Tattoo Blue Studio Sl')?.etiqueta).toBe('cat-ropa');
  });

  it('ignora gastos borrados al entrenar', () => {
    const m = entrenar(ejemplosDeEntrenamiento(categoria, [{ comercio: 'Quimera Unica', categoriaId: 'cat-viajes', borrado: true }]));
    expect(sugerencia(m, 'Quimera Unica')).toBeNull();
  });
});

describe('integración con la importación', () => {
  it('pre-rellena la categoría de un comercio desconocido pero lo deja en revisión', async () => {
    const { aplicarAprendizaje } = await import('./importar');
    const { UMBRAL_REVISION } = await import('./clasificar');
    const m = entrenar(ejemplosDeEntrenamiento(categoria, [{ comercio: 'Gym Ibiza Fitness', categoriaId: 'cat-ocio' }]));
    const mov = {
      id: 'h', cuenta: 'Revolut', fecha: '2026-03-01', anio: 2026, mes: 3, importe: -3000, concepto: 'IBIZA FITNESS CENTER', duplicado: false, pareja: null, recurrente: false,
      propuesta: { destino: 'gasto' as const, categoria: 'otros' as const, categoriaId: null, tipoGasto: 'Variable' as const, pagador: null, devolucion: false, confianza: 0.2, motivo: 'Comercio desconocido', limpio: { comercio: 'Ibiza Fitness Center', clave: 'fitness', busqueda: 'ibiza fitness center', persona: null } },
    };
    aplicarAprendizaje([mov], m);
    expect(mov.propuesta.categoriaId).toBe('cat-ocio');
    expect(mov.propuesta.confianza).toBeLessThan(UMBRAL_REVISION);
    expect(mov.propuesta.motivo).toMatch(/aprendizaje local/);
  });
});
