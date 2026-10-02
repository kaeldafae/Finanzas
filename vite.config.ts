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
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Única salida permitida: la API de GitHub para la sincronización cifrada.
    "connect-src 'self' https://api.github.com",
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

export default defineConfig({
  base,
  plugins: [
    react(),
    csp(),
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
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
