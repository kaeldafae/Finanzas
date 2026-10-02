import type { TextoPdf } from '../domain/importacion/pdf';

const MAX_PAGINAS = 200;

/** El PDF pide contraseña (o la que se ha escrito no es la correcta). */
export class PdfConContrasena extends Error {
  constructor(readonly incorrecta: boolean, opciones?: ErrorOptions) {
    super(incorrecta ? 'La contraseña del PDF no es correcta.' : 'Este PDF está protegido con contraseña.', opciones);
    this.name = 'PdfConContrasena';
  }
}

/**
 * Extrae el texto del PDF con su posición, en el propio dispositivo. Usa pdf.js (Mozilla) en un worker
 * servido por la app: sin CDN y sin enviar el archivo a ningún sitio. pdf.js 6 no ejecuta código
 * del PDF (ni JavaScript embebido ni funciones compiladas con eval).
 */
export async function leerTextoPdf(datos: ArrayBuffer, contrasena?: string): Promise<{ textos: TextoPdf[]; paginas: number }> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
  }
  const tarea = pdfjs.getDocument({
    data: new Uint8Array(datos),
    ...(contrasena ? { password: contrasena } : {}),
    // Solo texto: sin fuentes externas, sin descargas y sin XFA.
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    enableXfa: false,
    stopAtErrors: false,
  });
  const doc = await tarea.promise.catch((e: unknown) => {
    if (e instanceof pdfjs.PasswordException) {
      throw new PdfConContrasena(e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD, { cause: e });
    }
    if (e instanceof pdfjs.InvalidPDFException) throw new Error('El archivo no es un PDF válido o está dañado.', { cause: e });
    throw e;
  });
  try {
    if (doc.numPages > MAX_PAGINAS) throw new Error(`El PDF tiene ${doc.numPages} páginas: demasiadas para un extracto (máximo ${MAX_PAGINAS}).`);
    const textos: TextoPdf[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p);
      const contenido = await pagina.getTextContent();
      for (const item of contenido.items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const t = item.transform as number[];
        textos.push({ texto: item.str, x: t[4] ?? 0, y: t[5] ?? 0, ancho: item.width, alto: item.height || Math.abs(t[3] ?? 0) || 8, pagina: p });
      }
      pagina.cleanup();
    }
    return { textos, paginas: doc.numPages };
  } finally {
    await tarea.destroy();
  }
}
