import { describe, expect, it } from 'vitest';
import type { Pagador } from './modelo';
import { pagadorPorTexto } from './pagadores';

const p = (id: string, nombre: string, extra: Partial<Pagador> = {}): Pagador => ({ id, nombre, tipo: 'Empresa', archivado: false, ...extra });

describe('elegir empresa con varias', () => {
  const empresas = [p('h', 'Hoteles Ibiza SL', { nif: 'B07123456' }), p('b', 'Beach Club Salinas SL'), p('s', 'SEPE', { tipo: 'SEPE' })];

  it('con una sola empresa, es esa', () => {
    expect(pagadorPorTexto('cualquier cosa', [p('u', 'Única SL')], 'Empresa')).toBe('u');
  });

  it('por el nombre que aparece en el concepto del banco', () => {
    expect(pagadorPorTexto('TRANSF NOMINA BEACH CLUB SALINAS', empresas, 'Empresa')).toBe('b');
    expect(pagadorPorTexto('Nómina Hoteles Ibiza mayo', empresas, 'Empresa')).toBe('h');
  });

  it('por el CIF de la nómina aunque el nombre no coincida', () => {
    expect(pagadorPorTexto('Explotaciones Turísticas', empresas, 'Empresa', 'B-07123456')).toBe('h');
  });

  it('si no hay pistas o empatan, no adivina', () => {
    expect(pagadorPorTexto('Transferencia recibida', empresas, 'Empresa')).toBeNull();
    const dos = [p('a', 'Ibiza Hoteles SL'), p('c', 'Ibiza Beach SL')];
    expect(pagadorPorTexto('Nomina Ibiza', dos, 'Empresa')).toBeNull();
  });

  it('ignora las archivadas y las de otro tipo', () => {
    expect(pagadorPorTexto('Hoteles', [p('h', 'Hoteles SL', { archivado: true }), p('b', 'Beach SL')], 'Empresa')).toBe('b');
  });
});
