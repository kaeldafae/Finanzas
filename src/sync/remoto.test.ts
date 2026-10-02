import { describe, expect, it } from 'vitest';
import { ClienteGitHub, ErrorRemoto, validarRepo } from './remoto';

type Llamada = { url: string; init: RequestInit };

function fetchFalso(respuestas: Array<() => Response>) {
  const llamadas: Llamada[] = [];
  const fn = (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    const r = respuestas.shift();
    if (!r) throw new Error('sin respuesta preparada');
    return Promise.resolve(r());
  };
  return { fn, llamadas };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('cliente de GitHub', () => {
  it('lee el archivo (base64 con saltos de línea y UTF-8) y solo llama a api.github.com', async () => {
    const texto = '{"nota":"Nómina €"}';
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(texto))).replace(/(.{10})/g, '$1\n');
    const { fn, llamadas } = fetchFalso([json(200, { sha: 'abc', content: b64, encoding: 'base64' })]);
    const r = await new ClienteGitHub('yo/datos', 'tok', undefined, fn).leer();
    expect(r).toEqual({ sha: 'abc', texto });
    expect(llamadas[0]?.url).toBe('https://api.github.com/repos/yo/datos/contents/finanzas.sync.json');
    expect(llamadas[0]?.init.cache).toBe('no-store');
    expect((llamadas[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('archivo inexistente → null', async () => {
    const { fn } = fetchFalso([json(404, { message: 'Not Found' })]);
    expect(await new ClienteGitHub('yo/datos', 'tok', undefined, fn).leer()).toBeNull();
  });

  it('escribe con sha y detecta conflictos (409 y 422)', async () => {
    const { fn, llamadas } = fetchFalso([json(200, { content: { sha: 'nuevo' } }), json(409, {}), json(422, {})]);
    const c = new ClienteGitHub('yo/datos', 'tok', undefined, fn);
    expect(await c.escribir('hola', 'viejo')).toEqual({ ok: true, sha: 'nuevo' });
    const cuerpoTexto = llamadas[0]?.init.body;
    const cuerpo = JSON.parse(typeof cuerpoTexto === 'string' ? cuerpoTexto : '{}') as { sha: string; content: string };
    expect(cuerpo.sha).toBe('viejo');
    expect(atob(cuerpo.content)).toBe('hola');
    expect(await c.escribir('x', 'viejo')).toEqual({ ok: false, conflicto: true });
    expect(await c.escribir('x', null)).toEqual({ ok: false, conflicto: true });
  });

  it('token caducado, sin permisos o sin red → errores claros', async () => {
    const { fn } = fetchFalso([json(401, {}), json(403, {})]);
    const c = new ClienteGitHub('yo/datos', 'tok', undefined, fn);
    await expect(c.leer()).rejects.toMatchObject({ motivo: 'token' });
    await expect(c.leer()).rejects.toMatchObject({ motivo: 'permisos' });
    const sinRed = new ClienteGitHub('yo/datos', 'tok', undefined, () => Promise.reject(new TypeError('offline')));
    await expect(sinRed.leer()).rejects.toBeInstanceOf(ErrorRemoto);
  });

  it('rechaza repositorios públicos', async () => {
    const { fn } = fetchFalso([json(200, { private: false }), json(200, { private: true })]);
    const c = new ClienteGitHub('yo/datos', 'tok', undefined, fn);
    await expect(c.verificarRepo()).rejects.toMatchObject({ motivo: 'publico' });
    await expect(c.verificarRepo()).resolves.toBeUndefined();
  });

  it('valida el formato usuario/repositorio', () => {
    expect(validarRepo('kaeldafae/finanzas-datos')).toBeNull();
    expect(validarRepo('https://github.com/x/y')).not.toBeNull();
    expect(validarRepo('solo-nombre')).not.toBeNull();
  });
});
