import { formatearEuros, sumar, type Centimos } from './dinero';
import type { MotorIA } from './importacion/iaLocal';
import { costeMensual } from './compromisos';
import { compararPeriodos, idMes, importeGasto, nombreMes, sumarMeses, type Categoria, type Gasto, type Periodo } from './modelo';
import { estadoObjetivo } from './objetivos';
import type { DatosFinancieros } from './resumen';

/**
 * Asistente de preguntas sobre tus finanzas. La pregunta se convierte en una consulta estructurada
 * (con reglas en español o, si no se entiende, con la IA local limitada a un esquema JSON). El cálculo
 * lo hace siempre el motor y las cifras se escriben con plantillas: la IA nunca redacta un importe.
 */

export const TIPOS_CONSULTA = ['gasto', 'ingreso', 'resultado', 'comparar', 'categorias', 'recurrentes', 'objetivos', 'movimientos'] as const;
export type TipoConsulta = (typeof TIPOS_CONSULTA)[number];

export interface Consulta {
  tipo: TipoConsulta;
  desde: Periodo;
  hasta: Periodo;
  /** Para "comparar": el segundo periodo. */
  desde2?: Periodo;
  hasta2?: Periodo;
  categoriaId?: string;
  comercio?: string;
}

export interface Respuesta {
  titulo: string;
  texto: string;
  cifras: { etiqueta: string; importe: Centimos }[];
  evidencia: string;
  movimientos: { fecha: string; concepto: string; importe: Centimos }[];
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const RE_MES = `(${MESES.join('|')}|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)`;

function norm(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

function mesDe(palabra: string): number {
  const i = MESES.findIndex((m) => m === palabra || m.startsWith(palabra.slice(0, 3)));
  return i + 1;
}

const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  restaurantes: ['restaurante', 'restaurantes', 'bares', 'bar', 'comer fuera', 'cenas'],
  comida: ['comida', 'supermercado', 'super', 'mercadona', 'compra'],
  transporte: ['transporte', 'gasolina', 'coche', 'taxi', 'bus'],
  alquiler: ['alquiler', 'piso', 'casa'],
  suscripciones: ['suscripciones', 'suscripcion', 'netflix', 'spotify'],
  ocio: ['ocio', 'fiesta', 'discoteca', 'cine'],
  ropa: ['ropa', 'peluqueria'],
  salud: ['salud', 'farmacia', 'medico'],
  suministros: ['luz', 'agua', 'gas', 'suministros'],
  movil: ['movil', 'internet', 'telefono'],
  viajes: ['viajes', 'viaje', 'vuelos', 'hotel'],
  efectivo: ['efectivo', 'cajero'],
  comisiones: ['comisiones', 'comision'],
};

function buscarCategoria(t: string, categorias: readonly Categoria[]): string | undefined {
  const activas = categorias.filter((c) => !c.archivada);
  const porNombre = activas.find((c) => new RegExp(`\\b${norm(c.nombre).split(/[ /]/)[0] ?? ''}\\b`).test(t));
  if (porNombre) return porNombre.id;
  for (const [clave, palabras] of Object.entries(SINONIMOS)) {
    if (palabras.some((p) => new RegExp(`\\b${p}\\b`).test(t))) return activas.find((c) => c.clave === clave)?.id;
  }
  return undefined;
}

/** Periodos que aparecen en la pregunta; si no hay ninguno, este año hasta hoy. */
function periodos(t: string, hoy: Periodo): { desde: Periodo; hasta: Periodo }[] {
  const out: { desde: Periodo; hasta: Periodo }[] = [];
  const ultimos = /ultimos (\d{1,2}) meses/.exec(t);
  if (ultimos) out.push({ desde: sumarMeses(hoy, -(Number(ultimos[1]) - 1)), hasta: hoy });
  if (/\beste mes\b/.test(t)) out.push({ desde: hoy, hasta: hoy });
  if (/\bmes pasado\b/.test(t)) out.push({ desde: sumarMeses(hoy, -1), hasta: sumarMeses(hoy, -1) });
  if (/\beste ano\b/.test(t)) out.push({ desde: { anio: hoy.anio, mes: 1 }, hasta: hoy });
  if (/\bano pasado\b/.test(t)) out.push({ desde: { anio: hoy.anio - 1, mes: 1 }, hasta: { anio: hoy.anio - 1, mes: 12 } });
  const rango = new RegExp(`desde ${RE_MES}(?: de (\\d{4}))? (?:hasta|a) ${RE_MES}(?: de (\\d{4}))?`).exec(t);
  if (rango?.[1] && rango[3]) {
    out.push({ desde: { anio: Number(rango[2] ?? hoy.anio), mes: mesDe(rango[1]) }, hasta: { anio: Number(rango[4] ?? rango[2] ?? hoy.anio), mes: mesDe(rango[3]) } });
  } else {
    for (const m of t.matchAll(new RegExp(`\\b${RE_MES}\\b(?: (?:de |del )?(\\d{4}))?`, 'g'))) {
      if (!m[1]) continue;
      const mes = mesDe(m[1]);
      // Sin año: el último mes con ese nombre que no sea futuro.
      const anio = m[2] ? Number(m[2]) : mes > hoy.mes ? hoy.anio - 1 : hoy.anio;
      out.push({ desde: { anio, mes }, hasta: { anio, mes } });
    }
  }
  const anio = /\b(?:en|del|de) (20\d{2})\b/.exec(t);
  if (out.length === 0 && anio?.[1]) out.push({ desde: { anio: Number(anio[1]), mes: 1 }, hasta: { anio: Number(anio[1]), mes: 12 } });
  return out;
}

/** Interpreta la pregunta con reglas. null si no la entiende (entonces se puede probar con la IA local). */
export function interpretar(pregunta: string, hoy: Periodo, categorias: readonly Categoria[], comercios: readonly string[] = []): Consulta | null {
  const t = norm(pregunta);
  if (!t) return null;
  const ps = periodos(t, hoy);
  const p = ps[0] ?? { desde: { anio: hoy.anio, mes: 1 }, hasta: hoy };
  const categoriaId = buscarCategoria(t, categorias);
  const comercio = comercios.find((c) => c.length >= 3 && t.includes(norm(c)));
  const extra = { ...(categoriaId ? { categoriaId } : {}), ...(comercio ? { comercio } : {}) };

  if (/\b(recurrentes?|suscripciones|fijos|cuotas|recibos)\b/.test(t) && !/\b(gast|pagu|pagad|cuanto)\w*/.test(t)) return { tipo: 'recurrentes', ...p };
  if (/\b(objetivos?|metas?)\b/.test(t)) return { tipo: 'objetivos', ...p };
  if (/\b(compar|frente a|respecto a|vs)\w*/.test(t) && ps.length >= 2) {
    const [a, b] = ps;
    if (a && b) return { tipo: 'comparar', desde: a.desde, hasta: a.hasta, desde2: b.desde, hasta2: b.hasta, ...extra };
  }
  if (/\b(en que|donde|categorias?)\b.*\b(gast|mas)\w*/.test(t) || /\bmas gasto\b/.test(t)) return { tipo: 'categorias', ...p };
  if (/\b(movimientos|pagos a|compras en|cuando)\b/.test(t) && (comercio || categoriaId)) return { tipo: 'movimientos', ...p, ...extra };
  if (/\b(ahorr|resultado|sobr|me quedo|balance)\w*/.test(t)) return { tipo: 'resultado', ...p };
  if (/\b(ingres|cobr|gane|sueldo|nomina)\w*/.test(t)) return { tipo: 'ingreso', ...p };
  if (/\b(gast|pague|pagado|cuesta|costo|me deja)\w*/.test(t) || categoriaId || comercio) return { tipo: 'gasto', ...p, ...extra };
  return null;
}

// --- Validación de lo que proponga la IA (nunca se usa sin pasar por aquí) --------------------

function periodoValido(v: unknown): v is Periodo {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Number.isInteger(o['anio']) && Number.isInteger(o['mes']) && (o['anio'] as number) >= 2000 && (o['anio'] as number) <= 2100 && (o['mes'] as number) >= 1 && (o['mes'] as number) <= 12;
}

export function validarConsulta(v: unknown, categorias: readonly Categoria[]): Consulta | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const tipo = o['tipo'];
  if (typeof tipo !== 'string' || !(TIPOS_CONSULTA as readonly string[]).includes(tipo)) return null;
  if (!periodoValido(o['desde']) || !periodoValido(o['hasta']) || compararPeriodos(o['desde'], o['hasta']) > 0) return null;
  const c: Consulta = { tipo: tipo as TipoConsulta, desde: o['desde'], hasta: o['hasta'] };
  if (periodoValido(o['desde2']) && periodoValido(o['hasta2'])) {
    c.desde2 = o['desde2'];
    c.hasta2 = o['hasta2'];
  }
  if (typeof o['categoria'] === 'string' && o['categoria']) {
    const cat = categorias.find((x) => norm(x.nombre) === norm(String(o['categoria'])));
    if (cat) c.categoriaId = cat.id;
  }
  if (c.tipo === 'comparar' && !c.desde2) return null;
  return c;
}

/** Esquema JSON para la IA local: solo puede devolver una consulta, nunca cifras. */
export function esquemaConsulta(categorias: readonly Categoria[]): string {
  const periodo = { type: 'object', properties: { anio: { type: 'integer' }, mes: { type: 'integer' } }, required: ['anio', 'mes'] };
  return JSON.stringify({
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: [...TIPOS_CONSULTA] },
      desde: periodo,
      hasta: periodo,
      desde2: periodo,
      hasta2: periodo,
      categoria: { type: 'string', enum: ['', ...categorias.filter((c) => !c.archivada).map((c) => c.nombre)] },
    },
    required: ['tipo', 'desde', 'hasta', 'categoria'],
  });
}

// --- Motor de respuestas -----------------------------------------------------------------------

const etiqueta = (desde: Periodo, hasta: Periodo) => {
  const t = (p: Periodo) => `${nombreMes(p.mes).toLowerCase()} ${p.anio}`;
  return compararPeriodos(desde, hasta) === 0 ? t(desde) : `${t(desde)} – ${t(hasta)}`;
};

function enRango<T extends Periodo>(filas: readonly T[], desde: Periodo, hasta: Periodo): T[] {
  return filas.filter((f) => !('borrado' in f && f.borrado) && compararPeriodos(f, desde) >= 0 && compararPeriodos(f, hasta) <= 0);
}

function evidencia(filas: readonly { huella?: string }[], meses: number): string {
  const importados = filas.filter((f) => f.huella).length;
  return `${filas.length} movimientos en ${meses} ${meses === 1 ? 'mes' : 'meses'}: ${importados} importados del banco (verificados al importar) y ${filas.length - importados} apuntados a mano.`;
}

function numMeses(desde: Periodo, hasta: Periodo): number {
  return (hasta.anio - desde.anio) * 12 + hasta.mes - desde.mes + 1;
}

export function responder(c: Consulta, d: DatosFinancieros, hoy: Periodo): Respuesta {
  const nombreCat = (id: string) => d.categorias.find((x) => x.id === id)?.nombre ?? 'Sin categoría';
  const rango = etiqueta(c.desde, c.hasta);
  const filtroGasto = (g: Gasto) => (!c.categoriaId || g.categoriaId === c.categoriaId) && (!c.comercio || norm(g.comercio ?? g.nota).includes(norm(c.comercio)));
  const lista = (gs: readonly Gasto[]) =>
    [...gs].sort((a, b) => importeGasto(b) - importeGasto(a)).slice(0, 20).map((g) => ({ fecha: g.fecha ?? idMes(g.anio, g.mes), concepto: g.comercio ?? (g.nota || nombreCat(g.categoriaId)), importe: -importeGasto(g) }));
  const sujeto = c.comercio ? `en ${c.comercio}` : c.categoriaId ? `en ${nombreCat(c.categoriaId)}` : 'en total';

  switch (c.tipo) {
    case 'gasto':
    case 'movimientos': {
      const gs = enRango(d.gastos, c.desde, c.hasta).filter(filtroGasto);
      const total = sumar(gs.map(importeGasto));
      const n = numMeses(c.desde, c.hasta);
      return {
        titulo: `Gasto ${sujeto} · ${rango}`,
        texto: `Has gastado ${formatearEuros(total)} ${sujeto} (${rango})${n > 1 ? `: una media de ${formatearEuros(Math.round(total / n))} al mes` : ''}.`,
        cifras: [{ etiqueta: 'Total', importe: total }, ...(n > 1 ? [{ etiqueta: 'Media mensual', importe: Math.round(total / n) }] : [])],
        evidencia: evidencia(gs, n),
        movimientos: lista(gs),
      };
    }
    case 'ingreso': {
      const is = enRango(d.ingresos, c.desde, c.hasta);
      const es = enRango(d.extras, c.desde, c.hasta);
      const nomina = sumar(is.filter((i) => i.estado === 'Real').map((i) => i.neto));
      const previsto = sumar(is.filter((i) => i.estado === 'Previsto').map((i) => i.neto));
      const extras = sumar(es.map((e) => e.importe));
      return {
        titulo: `Ingresos · ${rango}`,
        texto: `Has cobrado ${formatearEuros(nomina + extras)} netos (${rango}): ${formatearEuros(nomina)} de nóminas y prestaciones y ${formatearEuros(extras)} de propinas y otros.${previsto > 0 ? ` Además hay ${formatearEuros(previsto)} previstos, que no están sumados.` : ''}`,
        cifras: [{ etiqueta: 'Nóminas y SEPE (real)', importe: nomina }, { etiqueta: 'Propinas y otros', importe: extras }, ...(previsto > 0 ? [{ etiqueta: 'Previsto (aparte)', importe: previsto }] : [])],
        evidencia: evidencia([...is, ...es], numMeses(c.desde, c.hasta)),
        movimientos: [],
      };
    }
    case 'resultado': {
      const ingresos = sumar(enRango(d.ingresos, c.desde, c.hasta).filter((i) => i.estado === 'Real').map((i) => i.neto)) + sumar(enRango(d.extras, c.desde, c.hasta).map((e) => e.importe));
      const gs = enRango(d.gastos, c.desde, c.hasta);
      const gastos = sumar(gs.map(importeGasto));
      return {
        titulo: `Resultado · ${rango}`,
        texto: `Entre ingresos (${formatearEuros(ingresos)}) y gastos (${formatearEuros(gastos)}), el resultado es ${formatearEuros(ingresos - gastos)} (${rango}).`,
        cifras: [{ etiqueta: 'Ingresos', importe: ingresos }, { etiqueta: 'Gastos', importe: gastos }, { etiqueta: 'Resultado', importe: ingresos - gastos }],
        evidencia: evidencia(gs, numMeses(c.desde, c.hasta)),
        movimientos: [],
      };
    }
    case 'comparar': {
      const d2 = c.desde2 ?? c.desde;
      const h2 = c.hasta2 ?? c.hasta;
      const a = sumar(enRango(d.gastos, c.desde, c.hasta).filter(filtroGasto).map(importeGasto));
      const b = sumar(enRango(d.gastos, d2, h2).filter(filtroGasto).map(importeGasto));
      const dif = b - a;
      const pct = a > 0 ? ` (${dif >= 0 ? '+' : ''}${Math.round((dif / a) * 100)} %)` : '';
      return {
        titulo: `Comparación de gasto ${sujeto}`,
        texto: `${etiqueta(c.desde, c.hasta)}: ${formatearEuros(a)}. ${etiqueta(d2, h2)}: ${formatearEuros(b)}. Diferencia: ${formatearEuros(dif)}${pct}.`,
        cifras: [{ etiqueta: etiqueta(c.desde, c.hasta), importe: a }, { etiqueta: etiqueta(d2, h2), importe: b }, { etiqueta: 'Diferencia', importe: dif }],
        evidencia: evidencia([...enRango(d.gastos, c.desde, c.hasta), ...enRango(d.gastos, d2, h2)].filter(filtroGasto), numMeses(c.desde, c.hasta) + numMeses(d2, h2)),
        movimientos: [],
      };
    }
    case 'categorias': {
      const gs = enRango(d.gastos, c.desde, c.hasta);
      const porCat = new Map<string, Centimos>();
      for (const g of gs) porCat.set(g.categoriaId, (porCat.get(g.categoriaId) ?? 0) + importeGasto(g));
      const top = [...porCat].sort((x, y) => y[1] - x[1]).slice(0, 8);
      const total = sumar(gs.map(importeGasto));
      return {
        titulo: `En qué se va el dinero · ${rango}`,
        texto: top.length ? `Lo que más pesa es ${nombreCat(top[0]?.[0] ?? '')} con ${formatearEuros(top[0]?.[1] ?? 0)} de ${formatearEuros(total)} en total.` : 'No hay gastos en ese periodo.',
        cifras: top.map(([id, imp]) => ({ etiqueta: nombreCat(id), importe: imp })),
        evidencia: evidencia(gs, numMeses(c.desde, c.hasta)),
        movimientos: [],
      };
    }
    case 'recurrentes': {
      const cs = d.compromisos.filter((x) => x.activo && !x.borrado);
      const mensual = sumar(cs.map(costeMensual));
      return {
        titulo: 'Pagos recurrentes',
        texto: cs.length ? `Tienes ${cs.length} pagos recurrentes guardados: unos ${formatearEuros(mensual)} al mes en total.` : 'No hay pagos recurrentes guardados. Revísalos en Ajustes → Pagos recurrentes.',
        cifras: cs.map((x) => ({ etiqueta: `${x.nombre} (${x.periodicidad})`, importe: x.importe })),
        evidencia: 'Pagos recurrentes que has confirmado en Ajustes.',
        movimientos: [],
      };
    }
    case 'objetivos': {
      const os = d.objetivos.filter((x) => !x.archivado && !x.borrado);
      return {
        titulo: 'Objetivos de ahorro',
        texto: os.length
          ? os.map((o) => {
              const e = estadoObjetivo(o, hoy);
              return `${o.nombre}: ${formatearEuros(o.importeActual)} de ${formatearEuros(o.importeObjetivo)} (${Math.floor(e.progreso / 100)} %)${e.completo ? ', completo' : e.fechaEstimada ? `, al ritmo actual en ${nombreMes(e.fechaEstimada.mes).toLowerCase()} ${e.fechaEstimada.anio}` : ''}.`;
            }).join(' ')
          : 'No tienes objetivos de ahorro. Créalos en la pantalla Ahorro.',
        cifras: os.map((o) => ({ etiqueta: o.nombre, importe: o.importeActual })),
        evidencia: 'Objetivos guardados y sus aportaciones.',
        movimientos: [],
      };
    }
  }
}

// --- Pregunta libre con la IA local (solo traduce la pregunta a una consulta) --------------------

export async function interpretarConIA(motor: MotorIA, pregunta: string, hoy: Periodo, categorias: readonly Categoria[]): Promise<Consulta | null> {
  const nombres = categorias.filter((c) => !c.archivada).map((c) => c.nombre);
  const mensajes = [
    {
      role: 'system' as const,
      content: `Conviertes preguntas sobre finanzas personales en una consulta JSON. No calculas nada ni das cifras. Hoy es ${nombreMes(hoy.mes).toLowerCase()} de ${hoy.anio} (anio ${hoy.anio}, mes ${hoy.mes}).
Tipos: gasto (cuánto se gastó), ingreso, resultado (ahorro o balance), comparar (dos periodos: desde/hasta y desde2/hasta2), categorias (en qué se gasta más), recurrentes, objetivos, movimientos (lista de pagos).
"categoria" debe ser una de: ${nombres.join('; ')}; o "" si no se menciona.`,
    },
    { role: 'user' as const, content: pregunta.slice(0, 300) },
  ];
  try {
    const texto = await motor.generar(mensajes, esquemaConsulta(categorias));
    return validarConsulta(JSON.parse(texto), categorias);
  } catch {
    return null;
  }
}
