import { esImporte } from './pdf';
import { inferirPorContenido, type LecturaExtracto } from './formatos';
import { parsearFecha, type Celda } from './texto';

/**
 * Movimientos pegados como texto: lo que copia «Texto en vivo» del iPhone de una captura o foto del
 * extracto, o lo que se selecciona en la web del banco. Cada línea con fecha, concepto e importe (y saldo
 * si lo hay). También admite listas agrupadas por día, con la fecha en una línea propia.
 * Se valida igual que un archivo: si hay saldo, tiene que cuadrar.
 */

/**
 * Fecha al principio de la línea (las palabras justas). Sin año ("3 mar", "3 de marzo"), como en las
 * listas de las apps, se toma el año que deja la fecha en el pasado más reciente.
 */
function fechaAlInicio(palabras: readonly string[], hoy: string): { fecha: string; usadas: number } | null {
  for (let k = 1; k <= Math.min(5, palabras.length); k++) {
    const t = palabras.slice(0, k).join(' ');
    if (parsearFecha(t) !== null) return { fecha: t, usadas: k };
    if (k >= 2 && /[a-z]/i.test(t)) {
      const anio = Number(hoy.slice(0, 4));
      const conAnio = parsearFecha(`${t.replace(/[,.]$/, '')} ${anio}`);
      if (conAnio !== null) return { fecha: conAnio <= hoy ? conAnio : (parsearFecha(`${t.replace(/[,.]$/, '')} ${anio - 1}`) ?? conAnio), usadas: k };
    }
  }
  return null;
}

/** Importes al final de la línea; acepta "45,30 €" partido en "45,30" y "€". */
function importesAlFinal(palabras: string[]): { importes: string[]; resto: string[] } {
  const importes: string[] = [];
  const p = [...palabras];
  while (p.length > 0 && importes.length < 2) {
    const ultima = p[p.length - 1] ?? '';
    const penultima = p[p.length - 2] ?? '';
    if (/^(€|EUR)$/i.test(ultima) && esImporte(`${penultima} ${ultima}`)) {
      importes.unshift(`${penultima} ${ultima}`);
      p.splice(-2);
    } else if (esImporte(ultima)) {
      importes.unshift(ultima);
      p.pop();
    } else break;
  }
  return { importes, resto: p };
}

export function filasDeTexto(texto: string, hoy: string): Celda[][] {
  const filas: Celda[][] = [];
  let fechaGrupo: string | null = null;
  let pendiente: string[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const palabras = bruta.replace(/[  ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) continue;
    const f = fechaAlInicio(palabras, hoy);
    const resto = f ? palabras.slice(f.usadas) : palabras;
    const { importes, resto: concepto } = importesAlFinal(resto);
    if (f && resto.length === 0) {
      // Línea solo con la fecha: cabecera de un grupo de movimientos.
      fechaGrupo = f.fecha;
      pendiente = [];
      continue;
    }
    const fecha = f?.fecha ?? fechaGrupo;
    if (!fecha) continue;
    if (importes.length === 0) {
      // Concepto en una línea y el importe en la siguiente (listas de las apps).
      pendiente = [...pendiente, ...concepto];
      continue;
    }
    const nombre = [...pendiente, ...concepto].join(' ');
    pendiente = [];
    filas.push([fecha, nombre, importes[0] ?? null, importes[1] ?? null]);
  }
  return filas;
}

/** `hoy` en ISO (aaaa-mm-dd): sirve para completar las fechas sin año. */
export function leerTextoPegado(texto: string, hoy: string): LecturaExtracto | null {
  const filas = filasDeTexto(texto, hoy);
  if (filas.length === 0) return null;
  const l = inferirPorContenido(filas);
  return l ? { ...l, deteccion: 'texto', banco: 'Cuenta' } : null;
}
