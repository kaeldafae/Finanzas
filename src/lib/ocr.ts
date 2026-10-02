import type { TextoPdf } from '../domain/importacion/pdf';

/**
 * OCR en el dispositivo con Tesseract.js (Apache-2.0). Solo se usa si el documento no lleva texto
 * (foto o PDF escaneado). Los archivos del motor y el idioma español los sirve la propia app
 * (sin CDN) y se descargan la primera vez que se usa (~6 MB). La imagen nunca sale del dispositivo.
 *
 * El resultado se convierte al mismo formato que el texto de un PDF: así pasa por el mismo lector y
 * las mismas comprobaciones (saldo y resumen). Un número mal reconocido hace que no cuadre y no se importa.
 */

const DIR = `${import.meta.env.BASE_URL}ocr/7.0.0/`;
/** Altura de referencia: el OCR mide desde arriba y el PDF desde abajo. */
const ALTO_REFERENCIA = 100_000;

export interface ProgresoOcr {
  progreso: number;
  texto: string;
}

export type Imagen = Blob | HTMLCanvasElement;

export async function reconocer(imagenes: readonly Imagen[], alProgresar?: (p: ProgresoOcr) => void): Promise<TextoPdf[]> {
  const { createWorker, OEM } = await import('tesseract.js');
  let pagina = 0;
  const worker = await createWorker('spa', OEM.LSTM_ONLY, {
    workerPath: `${DIR}worker.min.js`,
    corePath: DIR,
    langPath: DIR,
    gzip: true,
    // Sin blob: la política de seguridad solo permite workers de la propia app.
    workerBlobURL: false,
    logger: (m) => alProgresar?.({ progreso: (pagina + m.progress) / imagenes.length, texto: `Página ${pagina + 1} de ${imagenes.length}: ${m.status}` }),
  });
  try {
    // Mantiene los espacios entre columnas: ayuda a separar concepto e importes.
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const textos: TextoPdf[] = [];
    for (; pagina < imagenes.length; pagina++) {
      const img = imagenes[pagina];
      if (!img) continue;
      const r = await worker.recognize(img, {}, { blocks: true, text: false });
      for (const bloque of r.data.blocks ?? []) {
        for (const parrafo of bloque.paragraphs) {
          for (const linea of parrafo.lines) {
            for (const w of linea.words) {
              // Sin filtrar por confianza: Tesseract da confianza baja a importes bien leídos. Lo que protege
              // es el cuadre con el saldo y con el resumen.
              if (!w.text.trim()) continue;
              const { x0, y0, x1, y1 } = w.bbox;
              textos.push({ texto: w.text, x: x0, y: ALTO_REFERENCIA - y1, ancho: x1 - x0, alto: y1 - y0, pagina: pagina + 1 });
            }
          }
        }
      }
    }
    return textos;
  } finally {
    await worker.terminate();
  }
}

/** Páginas de un PDF escaneado convertidas en imágenes (con pdf.js) para el OCR. */
export async function paginasComoImagen(datos: ArrayBuffer, contrasena?: string, maxPaginas = 30): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
  }
  const tarea = pdfjs.getDocument({ data: new Uint8Array(datos), ...(contrasena ? { password: contrasena } : {}), useWorkerFetch: false, enableXfa: false });
  const doc = await tarea.promise;
  try {
    const out: HTMLCanvasElement[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPaginas); p++) {
      const pagina = await doc.getPage(p);
      // ~200 ppp: suficiente para el OCR sin disparar la memoria en el móvil.
      const vista = pagina.getViewport({ scale: 2.8 });
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.ceil(vista.width);
      lienzo.height = Math.ceil(vista.height);
      await pagina.render({ canvas: lienzo, viewport: vista }).promise;
      out.push(lienzo);
      pagina.cleanup();
    }
    return out;
  } finally {
    await tarea.destroy();
  }
}
