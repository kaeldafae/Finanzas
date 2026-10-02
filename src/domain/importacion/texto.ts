import { MAX_CENTIMOS, type Centimos } from '../dinero';

/** Celda tal como llega de un CSV (texto) o de un Excel (texto, número, fecha o vacía). */
export type Celda = string | number | boolean | Date | null;

// --- CSV --------------------------------------------------------------------------------------

/** Detecta el separador mirando la primera línea con contenido: ; , o tabulador. */
function detectarSeparador(texto: string): string {
  const linea = texto.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const cuenta = (c: string) => linea.split(c).length - 1;
  const candidatos: Array<[string, number]> = [[';', cuenta(';')], [',', cuenta(',')], ['\t', cuenta('\t')]];
  candidatos.sort((a, b) => b[1] - a[1]);
  return candidatos[0]?.[1] ? candidatos[0][0] : ',';
}

/** CSV según RFC 4180: comillas, comillas dobladas, saltos de línea dentro de comillas y BOM. */
export function leerCsv(texto: string): string[][] {
  const t = texto.replace(/^\uFEFF/, '');
  const sep = detectarSeparador(t);
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    if (comillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo);
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas;
}

// --- Importes con signo --------------------------------------------------------------------

export type SeparadorDecimal = ',' | '.';

/**
 * Importe con signo en céntimos. El separador decimal se indica siempre (cada banco usa uno),
 * para no adivinar si "1.234" son mil doscientos o uno con dos.
 * Acepta: "-1.234,56", "1234,56", "-12.50", "1,234.56", "(12,50)", "12,50 €", "−12,50", y números de Excel.
 */
export function parsearImporteBanco(v: Celda, decimal: SeparadorDecimal): Centimos | null {
  if (v === null || v === '' || typeof v === 'boolean' || v instanceof Date) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    const c = Math.round(v * 100);
    return Math.abs(c) <= MAX_CENTIMOS ? c : null;
  }
  let t = v.trim().replace(/[\s\u00a0\u202f€]|EUR/gi, '').replace(/\u2212/g, '-');
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith('-')) {
    negativo = !negativo;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  if (t.endsWith('-')) {
    negativo = !negativo;
    t = t.slice(0, -1);
  }
  const miles = decimal === ',' ? '.' : ',';
  const patron = decimal === ',' ? /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/ : /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;
  if (!patron.test(t)) return null;
  const [entera = '', fraccion = ''] = t.split(miles).join('').split(decimal);
  const c = Number(entera) * 100 + Number(fraccion.padEnd(2, '0'));
  if (!Number.isSafeInteger(c) || c > MAX_CENTIMOS) return null;
  return negativo ? -c : c;
}

/** Deduce el separador decimal de una columna de importes en texto. */
export function deducirDecimal(valores: readonly Celda[]): SeparadorDecimal {
  let coma = 0;
  let punto = 0;
  for (const v of valores) {
    if (typeof v !== 'string') continue;
    if (/,\d{1,2}\s*(€|EUR)?\s*-?$/i.test(v.trim())) coma++;
    else if (/\.\d{1,2}\s*(€|EUR)?\s*-?$/i.test(v.trim())) punto++;
  }
  return punto > coma ? '.' : ',';
}

// --- Fechas -------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

function fechaValida(a: number, m: number, d: number): string | null {
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCMonth() !== m - 1) return null; // 31/02 no existe
  return `${a}-${pad(m)}-${pad(d)}`;
}

const MESES: Readonly<Record<string, number>> = {
  ene: 1, enero: 1, jan: 1, january: 1, gen: 1, gener: 1,
  feb: 2, febrero: 2, february: 2, febrer: 2,
  mar: 3, marzo: 3, march: 3, marc: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5, maig: 5,
  jun: 6, junio: 6, june: 6, juny: 6,
  jul: 7, julio: 7, july: 7, juliol: 7,
  ago: 8, agosto: 8, aug: 8, august: 8, agost: 8,
  sep: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9, set: 9, setembre: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11, novembre: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12, des: 12, desembre: 12,
};

/** Fechas con el mes en letra, como en los PDF: "1 ene 2026", "1 de enero de 2026", "Jan 1, 2026", "1 Jan 2026". */
function fechaConMesEnLetra(t: string): string | null {
  const n = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let m = /^(\d{1,2})(?:\s+de)?\s+([a-z]+)\.?(?:\s+de)?,?\s+(\d{4})\b/.exec(n);
  if (m) {
    const mes = MESES[m[2] ?? ''];
    return mes ? fechaValida(Number(m[3]), mes, Number(m[1])) : null;
  }
  m = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(n);
  if (m) {
    const mes = MESES[m[1] ?? ''];
    return mes ? fechaValida(Number(m[3]), mes, Number(m[2])) : null;
  }
  return null;
}

/**
 * Fecha ISO "aaaa-mm-dd". Acepta dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, aaaa-mm-dd[ hh:mm:ss], el mes en letra
 * (español, inglés o catalán), fechas y números de serie de Excel.
 */
export function parsearFecha(v: Celda): string | null {
  if (v === null || typeof v === 'boolean') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Excel guarda fechas sin zona horaria: se leen en UTC para no cambiar de día.
    return fechaValida(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === 'number') {
    // Número de serie de Excel (días desde 1899-12-30).
    if (v < 36526 || v > 73051) return null;
    const f = new Date(Math.round((v - 25569) * 86_400_000));
    return fechaValida(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  const t = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return fechaValida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(t);
  if (m) {
    const a = Number(m[3]);
    return fechaValida(a < 100 ? 2000 + a : a, Number(m[2]), Number(m[1]));
  }
  return fechaConMesEnLetra(t);
}

export function normalizarTexto(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
