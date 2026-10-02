import { describe, expect, it } from 'vitest';
import type { Categoria } from '../modelo';
import { consenso, type ItemIA } from './ia';
import { construirMensajes, ejemplosDeEvaluacion, esquemaRespuesta, evaluarModelo, revisarConIALocal, TAM_LOTE, type MensajeIA, type MotorIA } from './iaLocal';

const categorias: Categoria[] = [
  { id: 'c-hogar', nombre: 'Hogar', orden: 0, archivada: false, clave: 'hogar' },
  { id: 'c-otros', nombre: 'Otros', orden: 1, archivada: false, clave: 'otros' },
  { id: 'c-rest', nombre: 'Restaurantes y bares', orden: 2, archivada: false, clave: 'restaurantes' },
  { id: 'c-pers', nombre: 'Personas (Bizum y transferencias)', orden: 3, archivada: false, clave: 'personas' },
];
const nombre = (id: string) => categorias.find((c) => c.id === id)?.nombre ?? id;
const items: ItemIA[] = Array.from({ length: 11 }, (_, i) => ({ n: i + 1, comercio: i % 2 ? `Ferreteria ${i}` : `Braseria ${i}`, veces: 1, rango: 'entre 10 y 50 €', sentido: 'gasto', ids: [`m${i}`] }));

/** Motor simulado: responde según el nombre del comercio que lee en el mensaje. */
function motorSimulado(opciones: { fallarLote?: number; discrepar?: number; basura?: boolean } = {}): MotorIA & { llamadas: MensajeIA[][] } {
  const llamadas: MensajeIA[][] = [];
  return {
    llamadas,
    generar(mensajes) {
      llamadas.push(mensajes);
      if (opciones.fallarLote === llamadas.length) return Promise.reject(new Error('sin memoria'));
      if (opciones.basura) return Promise.resolve('{"respuestas":[{"n":1,"categ');
      const segunda = (mensajes[0]?.content ?? '').startsWith('Eres un revisor');
      const filas = [...(mensajes[1]?.content ?? '').matchAll(/^(\d+)\. (\w+)/gm)].map((m) => {
        const n = Number(m[1]);
        let categoria = m[2] === 'Braseria' ? 'Restaurantes y bares' : 'Hogar';
        if (segunda && n === opciones.discrepar) categoria = 'Otros';
        return { n, categoria, tipo: 'Variable', seguridad: 'alta' };
      });
      return Promise.resolve(JSON.stringify({ respuestas: filas }));
    },
  };
}

describe('IA integrada (con motor simulado)', () => {
  it('el esquema obliga a elegir solo categorías de la lista (sin Personas)', () => {
    const e = JSON.parse(esquemaRespuesta(['Hogar', 'Otros'])) as { properties: { respuestas: { items: { properties: { categoria: { enum: string[] } } } } } };
    expect(e.properties.respuestas.items.properties.categoria.enum).toEqual(['Hogar', 'Otros']);
    const m = construirMensajes(items.slice(0, 2), ['Hogar'], 1).map((x) => x.content).join(' ');
    expect(m).not.toMatch(/Personas/);
  });

  it('procesa por lotes, hace dos pasadas distintas y el consenso acepta lo que coincide', async () => {
    const motor = motorSimulado({ discrepar: 4 });
    const avances: number[] = [];
    const { r1, r2 } = await revisarConIALocal(motor, items, categorias, (h) => avances.push(h));
    expect(motor.llamadas).toHaveLength(2 * Math.ceil(items.length / TAM_LOTE));
    expect(motor.llamadas[0]?.[0]?.content).not.toBe(motor.llamadas[2]?.[0]?.content);
    expect(r1.propuestas.size).toBe(11);
    expect(avances[avances.length - 1]).toBe(22);
    const c = consenso(items, r1.propuestas, r2.propuestas, () => ({ categoriaId: null, segura: false }), nombre);
    expect(c.filter((x) => x.estado === 'coinciden')).toHaveLength(10);
    expect(c.find((x) => x.n === 4)?.estado).toBe('discrepan');
    expect(c.find((x) => x.n === 1)?.categoriaId).toBe('c-rest');
  });

  it('si un lote falla, los demás siguen y lo fallido queda para revisión', async () => {
    const { r1 } = await revisarConIALocal(motorSimulado({ fallarLote: 1 }), items, categorias);
    expect(r1.propuestas.size).toBe(items.length - TAM_LOTE);
    expect(r1.errores[0]).toMatch(/sin memoria/);
  });

  it('una salida cortada no aplica nada', async () => {
    const { r1, r2 } = await revisarConIALocal(motorSimulado({ basura: true }), items, categorias);
    expect(r1.propuestas.size + r2.propuestas.size).toBe(0);
    expect(r1.errores.join(' ')).toMatch(/incompleta/);
  });
});

describe('evaluación de modelos con tus datos', () => {
  it('usa tus comercios confirmados como respuesta correcta y cuenta aciertos y fallos', async () => {
    const gastos = [
      { id: 'a', anio: 2026, mes: 1, categoriaId: 'c-rest', importe: 1000, tipo: 'Variable' as const, nota: '', comercio: 'Braseria Can Pep', huella: 'h1' },
      { id: 'b', anio: 2026, mes: 1, categoriaId: 'c-hogar', importe: 1000, tipo: 'Variable' as const, nota: '', comercio: 'Ferreteria Vila', huella: 'h2' },
      // El modelo simulado dirá "Hogar" y aquí la categoría correcta es Otros: un fallo.
      { id: 'c', anio: 2026, mes: 1, categoriaId: 'c-otros', importe: 1000, tipo: 'Variable' as const, nota: '', comercio: 'Ferreteria Online', huella: 'h3' },
      // Apuntado a mano (sin huella) o de personas: no sirve para evaluar.
      { id: 'd', anio: 2026, mes: 1, categoriaId: 'c-rest', importe: 1000, tipo: 'Variable' as const, nota: '', comercio: 'Bar' },
      { id: 'e', anio: 2026, mes: 1, categoriaId: 'c-pers', importe: 1000, tipo: 'Variable' as const, nota: '', comercio: 'Bizum enviado', huella: 'h4' },
    ];
    const ejemplos = ejemplosDeEvaluacion(gastos, categorias);
    expect(ejemplos.map((e) => e.comercio)).toEqual(['Braseria Can Pep', 'Ferreteria Vila', 'Ferreteria Online']);
    const r = await evaluarModelo(motorSimulado(), ejemplos, categorias);
    expect({ aciertos: r.aciertos, total: r.total, sinRespuesta: r.sinRespuesta, fallos: r.fallos }).toEqual({
      aciertos: 2, total: 3, sinRespuesta: 0, fallos: [{ comercio: 'Ferreteria Online', esperado: 'Otros', propuesto: 'Hogar' }],
    });
  });
});
