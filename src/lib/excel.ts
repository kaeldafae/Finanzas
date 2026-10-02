import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/browser';
import type { HojaExcel } from '../domain/excel';

const FORMATO_EUROS = '#,##0.00 [$€-C0A]';

function aHoja(h: HojaExcel): SheetData {
  return h.filas.map((fila, i) =>
    fila.map((v, col): Cell => {
      if (v === null) return null;
      if (i === 0) return { value: String(v), fontWeight: 'bold' };
      if (typeof v === 'number' && h.columnasImporte.includes(col)) return { value: v, type: Number, format: FORMATO_EUROS };
      return v;
    }),
  );
}

/** Genera el .xlsx en el propio dispositivo. */
export async function generarExcel(hojas: HojaExcel[]): Promise<Blob> {
  return writeXlsxFile(
    hojas.map((h) => ({
      data: aHoja(h),
      sheet: h.nombre.slice(0, 31),
      columns: h.anchos.map((width) => ({ width })),
      stickyRowsCount: 1,
    })),
  ).toBlob();
}
