import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

/** GitHub simulado: repositorio privado con un archivo y control de versiones por sha. */
function githubSimulado() {
  const gh = { archivo: null as { sha: string; b64: string } | null, n: 0 };
  async function ruta(route: Route) {
    const req = route.request();
    const u = new URL(req.url());
    if (!(req.headers()['authorization'] ?? '').startsWith('Bearer github_pat_')) return route.fulfill({ status: 401, body: '{}' });
    if (u.pathname === '/repos/yo/finanzas-datos') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ private: true }) });
    if (u.pathname === '/repos/yo/finanzas-datos/contents/finanzas.sync.json') {
      if (req.method() === 'GET') {
        if (!gh.archivo) return route.fulfill({ status: 404, body: '{"message":"Not Found"}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: gh.archivo.sha, content: gh.archivo.b64, encoding: 'base64' }) });
      }
      if (req.method() === 'PUT') {
        const cuerpo = JSON.parse(req.postData() ?? '{}') as { sha?: string; content: string };
        if ((gh.archivo?.sha ?? undefined) !== cuerpo.sha) return route.fulfill({ status: 409, body: '{}' });
        gh.archivo = { sha: `sha${++gh.n}`, b64: cuerpo.content };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: gh.archivo.sha } }) });
      }
    }
    return route.fulfill({ status: 404, body: '{}' });
  }
  return { gh, ruta };
}

async function dispositivo(browser: Browser, ruta: (r: Route) => Promise<void>): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-ES' });
  await ctx.route('https://api.github.com/**', ruta);
  const p = await ctx.newPage();
  p.on('dialog', (d) => void d.accept());
  await p.goto('/');
  await expect(p.getByRole('heading', { name: /Resultado del mes/ })).toBeVisible();
  return p;
}

async function conectar(p: Page, contrasena: string, primera: boolean) {
  await p.getByRole('link', { name: 'Ajustes' }).click();
  await p.getByLabel('Repositorio privado').fill('yo/finanzas-datos');
  await p.getByLabel('Token de GitHub', { exact: true }).fill(`github_pat_${'x'.repeat(40)}`);
  await p.getByRole('button', { name: 'Comprobar' }).click();
  await p.getByLabel('Contraseña de cifrado', { exact: true }).fill(contrasena);
  if (primera) await p.getByLabel('Repite la contraseña', { exact: true }).fill(contrasena);
  await p.getByRole('button', { name: 'Conectar' }).click();
}

async function anadirGasto(p: Page, categoria: string, importe: string) {
  await p.getByRole('link', { name: 'Mes' }).click();
  await p.getByRole('button', { name: '+ Gasto variable' }).click();
  await p.getByLabel('Categoría').selectOption({ label: categoria });
  await p.getByLabel('Importe (€)').fill(importe);
  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
}

test('sincronización cifrada entre dos dispositivos y cambio de contraseña', async ({ browser }) => {
  const { gh, ruta } = githubSimulado();
  const movil = await dispositivo(browser, ruta);
  await anadirGasto(movil, 'Comida', '42,50');
  await conectar(movil, 'mi frase secreta de prueba', true);
  await expect(movil.getByText('Sincronizado ✓')).toBeVisible();
  // GitHub solo ve datos cifrados.
  const subido = Buffer.from(gh.archivo?.b64 ?? '', 'base64').toString();
  expect(subido).not.toMatch(/Comida|4250/);

  const pc = await dispositivo(browser, ruta);
  await conectar(pc, 'contraseña equivocada', false);
  await expect(pc.getByText(/no es correcta/)).toBeVisible();
  await pc.getByLabel('Contraseña de cifrado', { exact: true }).fill('mi frase secreta de prueba');
  await pc.getByRole('button', { name: 'Conectar' }).click();
  await expect(pc.getByText('Sincronizado ✓')).toBeVisible();
  await pc.getByRole('link', { name: 'Mes' }).click();
  await expect(pc.getByText('42,50 €').first()).toBeVisible();

  // Cambio de contraseña desde el móvil; el PC lo detecta y pide la nueva.
  await movil.getByRole('link', { name: 'Ajustes' }).click();
  await movil.getByText('Cambiar contraseña de cifrado').click();
  await movil.getByLabel('Contraseña nueva', { exact: true }).fill('contraseña nueva segura 2026');
  await movil.getByLabel('Repite la contraseña nueva', { exact: true }).fill('contraseña nueva segura 2026');
  await movil.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
  await expect(movil.getByText('Sincronizado ✓')).toBeVisible();
  await anadirGasto(pc, 'Ocio', '7');
  await pc.getByRole('link', { name: 'Ajustes' }).click();
  await pc.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(pc.getByText(/se ha cambiado desde otro dispositivo/)).toBeVisible();
  await pc.getByLabel('Contraseña de cifrado', { exact: true }).fill('contraseña nueva segura 2026');
  await pc.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(pc.getByText('Sincronizado ✓')).toBeVisible();
  await movil.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(movil.getByText('Sincronizado ✓')).toBeVisible();
  await movil.getByRole('link', { name: 'Mes' }).click();
  await expect(movil.getByText('7,00 €').first()).toBeVisible();
});
