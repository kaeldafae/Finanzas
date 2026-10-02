import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// En GitHub Pages la app vive en /<repositorio>/. El workflow pasa BASE_PATH; en local es "/".
const base = process.env.BASE_PATH ?? '/';

/**
 * Política de seguridad de contenido solo en producción (el servidor de desarrollo usa scripts inline).
 * connect-src solo permite este origen y api.github.com (sincronización cifrada): ningún otro destino.
 */
function csp(): Plugin {
  const politica = [
    "default-src 'self'",
    // WebAssembly: la IA integrada compila su motor en el navegador.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Única salida permitida: la API de GitHub para la sincronización cifrada.
    // api.github.com: sincronización cifrada. Hugging Face y GitHub raw: SOLO descarga del modelo de IA integrada
    // (la IA se ejecuta en el dispositivo; tus datos no viajan a ninguno de estos destinos).
    "connect-src 'self' https://api.github.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${politica}" />`,
      );
    },
  };
}

/**
 * OCR bajo demanda (Tesseract.js): el worker, el motor WASM y el idioma español se sirven desde la propia
 * app, nunca desde un CDN. No se precargan: se descargan la primera vez que se usa el OCR (~6 MB).
 */
const requerir = createRequire(import.meta.url);
const OCR_DIR = 'ocr/7.0.0';
const ARCHIVOS_OCR: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'spa.traineddata.gz': '@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz',
};
function ocr(): Plugin {
  const leer = (nombre: string) => readFileSync(requerir.resolve(ARCHIVOS_OCR[nombre] ?? ''));
  return {
    name: 'ocr-local',
    configureServer(servidor) {
      servidor.middlewares.use((req, res, next) => {
        const m = new RegExp(`/${OCR_DIR}/([\\w.-]+)$`).exec(req.url ?? '');
        if (!m?.[1] || !ARCHIVOS_OCR[m[1]]) return next();
        res.setHeader('Content-Type', m[1].endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(leer(m[1]));
      });
    },
    generateBundle() {
      for (const nombre of Object.keys(ARCHIVOS_OCR)) this.emitFile({ type: 'asset', fileName: `${OCR_DIR}/${nombre}`, source: leer(nombre) });
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    csp(),
    ocr(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'icono.svg'],
      manifest: {
        id: base,
        name: 'Finanzas mes a mes',
        short_name: 'Finanzas',
        description: 'Tus ingresos, gastos, colchón y renta, mes a mes. Datos solo en tu móvil.',
        lang: 'es',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f7f5',
        theme_color: '#0f5c55',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // El motor de la IA integrada (~6 MB por archivo) no se precarga al instalar: solo lo baja
        // quien la usa, y desde ese momento queda guardado para funcionar sin conexión.
        globIgnores: ['**/ia-motor-*.js', '**/ia-worker-*.js', 'ocr/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/ia-(motor|worker)-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'motor-ia', expiration: { maxEntries: 6 } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr', expiration: { maxEntries: 10 } },
          },
        ],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 7000,
    rolldownOptions: {
      output: {
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => id.includes('@mlc-ai/web-llm')) ? 'assets/ia-motor-[hash].js' : 'assets/[name]-[hash].js',
      },
    },
  },
  worker: {
    format: 'es',
    rolldownOptions: {
      output: {
        // El worker de pdf.js se precarga (importar PDF sin conexión); el de la IA, no (pesa 6 MB).
        entryFileNames: (chunk) => (chunk.facadeModuleId?.includes('pdfjs-dist') ? 'assets/pdf-worker-[hash].js' : 'assets/ia-worker-[hash].js'),
      },
    },
  },
});
