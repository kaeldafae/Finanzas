import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { derivarClave, generarSal } from '../domain/cifrado';
import { euros } from '../domain/dinero';
import { BaseDatos } from '../db/db';
import { borrarGasto, guardarAjustes, guardarGasto, guardarPagador, leerAjustes, leerTodo } from '../db/operaciones';
import { sincronizar, ErrorSync, type ContextoSync } from './motor';
import type { ArchivoRemoto, ClienteRemoto, ResultadoEscritura } from './remoto';

/** "GitHub" en memoria con control de versión por sha, como la API real. */
class RemotoMemoria implements ClienteRemoto {
  archivo: ArchivoRemoto | null = null;
  private n = 0;
  /** Simula que otro dispositivo escribe justo antes de la próxima escritura. */
  interferir: (() => void) | null = null;

  leer(): Promise<ArchivoRemoto | null> {
    return Promise.resolve(this.archivo ? { ...this.archivo } : null);
  }

  escribir(texto: string, sha: string | null): Promise<ResultadoEscritura> {
    if (this.interferir) {
      const f = this.interferir;
      this.interferir = null;
      f();
    }
    if ((this.archivo?.sha ?? null) !== sha) return Promise.resolve({ ok: false, conflicto: true });
    this.archivo = { texto, sha: `sha${++this.n}` };
    return Promise.resolve({ ok: true, sha: this.archivo.sha });
  }
}

const IT = 1000;
const bases: BaseDatos[] = [];
let n = 0;

async function dispositivo(): Promise<BaseDatos> {
  const b = new BaseDatos(`sync-${n++}`);
  await b.open();
  bases.push(b);
  return b;
}

afterEach(async () => {
  for (const b of bases.splice(0)) await b.delete();
});

async function contexto(base: BaseDatos, cliente: ClienteRemoto, sal: string, contrasena = 'frase de prueba larga', primeraVez = false): Promise<ContextoSync> {
  return { base, cliente, clave: await derivarClave(contrasena, sal, IT), sal, iteraciones: IT, primeraVez };
}

const gasto = (importe: number, nota = '') => ({ anio: 2026, mes: 3, categoriaId: 'cat-comida', importe: euros(importe), tipo: 'Variable' as const, nota });

describe('sincronización entre dispositivos', () => {
  it('lo creado en el móvil aparece en el ordenador, y lo borrado desaparece', async () => {
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const movil = await dispositivo();
    const pc = await dispositivo();
    const cMovil = await contexto(movil, remoto, sal);
    const cPc = await contexto(pc, remoto, sal);

    await guardarGasto({ ...gasto(25), id: 'g1' }, movil);
    expect((await sincronizar(cMovil)).enviado).toBe(true);
    expect(remoto.archivo?.texto).not.toContain('cat-comida'); // cifrado

    const r = await sincronizar(cPc);
    expect(r.recibidos).toBeGreaterThan(0);
    expect((await leerTodo(pc)).gastos.map((g) => g.importe)).toEqual([euros(25)]);

    await borrarGasto('g1', pc);
    await sincronizar(cPc);
    await sincronizar(cMovil);
    expect((await leerTodo(movil)).gastos).toHaveLength(0);
  });

  it('cambios en los dos lados sin conexión se combinan; gana la última edición del mismo registro', async () => {
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const a = await dispositivo();
    const b = await dispositivo();
    const ca = await contexto(a, remoto, sal);
    const cb = await contexto(b, remoto, sal);

    await guardarGasto({ ...gasto(10), id: 'comun' }, a);
    await sincronizar(ca);
    await sincronizar(cb);

    await guardarGasto({ ...gasto(11), id: 'comun' }, a);
    await guardarGasto({ ...gasto(5), id: 'solo-a' }, a);
    await guardarGasto({ ...gasto(12), id: 'comun' }, b); // posterior
    await guardarGasto({ ...gasto(7), id: 'solo-b' }, b);

    await sincronizar(ca);
    await sincronizar(cb);
    await sincronizar(ca);

    for (const base of [a, b]) {
      const gs = (await leerTodo(base)).gastos.sort((x, y) => x.id.localeCompare(y.id));
      expect(gs.map((g) => [g.id, g.importe])).toEqual([
        ['comun', euros(12)],
        ['solo-a', euros(5)],
        ['solo-b', euros(7)],
      ]);
    }
  });

  it('si otro dispositivo sube a la vez, se vuelve a leer y fusionar sin perder nada', async () => {
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const a = await dispositivo();
    const b = await dispositivo();
    const ca = await contexto(a, remoto, sal);
    const cb = await contexto(b, remoto, sal);
    await sincronizar(ca);
    const inicial = remoto.archivo;

    // b sube "de-b"; se guarda esa versión y se vuelve atrás para simular que llega en mitad de la subida de a.
    await guardarGasto({ ...gasto(2), id: 'de-b' }, b);
    await sincronizar(cb);
    const versionB = remoto.archivo;
    remoto.archivo = inicial;

    await guardarGasto({ ...gasto(1), id: 'de-a' }, a);
    let conflictos = 0;
    remoto.interferir = () => {
      conflictos++;
      remoto.archivo = versionB;
    };
    await sincronizar(ca);
    expect(conflictos).toBe(1);
    expect((await leerTodo(a)).gastos.map((g) => g.id).sort()).toEqual(['de-a', 'de-b']);
    await sincronizar(cb);
    expect((await leerTodo(b)).gastos.map((g) => g.id).sort()).toEqual(['de-a', 'de-b']);
  });

  it('contraseña distinta en otro dispositivo → error y los datos locales intactos', async () => {
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const a = await dispositivo();
    const b = await dispositivo();
    await guardarGasto({ ...gasto(3), id: 'x' }, a);
    await sincronizar(await contexto(a, remoto, sal));
    await guardarGasto({ ...gasto(4), id: 'local-b' }, b);
    await expect(sincronizar(await contexto(b, remoto, sal, 'otra contraseña distinta'))).rejects.toThrow(/contraseña/);
    expect((await leerTodo(b)).gastos.map((g) => g.id)).toEqual(['local-b']);
  });

  it('si la contraseña se cambió en otro dispositivo (sal distinta) lo indica', async () => {
    const remoto = new RemotoMemoria();
    const a = await dispositivo();
    const b = await dispositivo();
    await sincronizar(await contexto(a, remoto, generarSal()));
    await expect(sincronizar(await contexto(b, remoto, generarSal()))).rejects.toBeInstanceOf(ErrorSync);
  });

  it('dos instalaciones nuevas no duplican categorías ni pagadores', async () => {
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const a = await dispositivo();
    const b = await dispositivo();
    await sincronizar(await contexto(a, remoto, sal));
    await sincronizar(await contexto(b, remoto, sal, undefined, true));
    const d = await leerTodo(b);
    expect(d.pagadores).toHaveLength(2);
    expect(new Set(d.categorias.map((c) => c.nombre)).size).toBe(d.categorias.length);
  });

  it('un dispositivo antiguo con ids aleatorios se unifica al conectarse por primera vez', async () => {
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const a = await dispositivo();
    const b = await dispositivo();
    await sincronizar(await contexto(a, remoto, sal));
    // b simula una instalación anterior: su SEPE tiene otro id y un ingreso que lo usa.
    await guardarPagador({ id: 'sepe-viejo', nombre: 'SEPE', tipo: 'SEPE', archivado: false }, b);
    await b.pagadores.delete('pag-sepe');
    await b.ingresos.add({ id: 'i1', anio: 2026, mes: 2, pagadorId: 'sepe-viejo', bruto: 1, seguridadSocial: 0, retencionIRPF: 0, neto: 1, netoManual: false, estado: 'Real', nota: '', actualizadoEl: 1 });
    await sincronizar(await contexto(b, remoto, sal, undefined, true));
    const d = await leerTodo(b);
    expect(d.pagadores.filter((p) => p.nombre === 'SEPE')).toHaveLength(1);
    expect(d.ingresos[0]?.pagadorId).toBe('pag-sepe');
  });

  it('los ajustes viajan, pero el tema se queda en cada dispositivo', async () => {
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const a = await dispositivo();
    const b = await dispositivo();
    await guardarAjustes({ tema: 'oscuro' }, b);
    await guardarAjustes({ mesesColchon: 9, tema: 'claro' }, a);
    await sincronizar(await contexto(a, remoto, sal));
    await sincronizar(await contexto(b, remoto, sal));
    const ajB = await leerAjustes(b);
    expect(ajB.mesesColchon).toBe(9);
    expect(ajB.tema).toBe('oscuro');
  });

  it('sin cambios no vuelve a subir nada', async () => {
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const a = await dispositivo();
    const ca = await contexto(a, remoto, sal);
    await sincronizar(ca);
    const sha = remoto.archivo?.sha;
    expect((await sincronizar(ca)).enviado).toBe(false);
    expect(remoto.archivo?.sha).toBe(sha);
  });
});

describe('cambio de contraseña', () => {
  it('un dispositivo conectado cambia la contraseña sin conocer la antigua; los demás piden la nueva y no se pierde nada', async () => {
    const { recifrar } = await import('./motor');
    const remoto = new RemotoMemoria();
    const salVieja = generarSal();
    const movil = await dispositivo();
    const pc = await dispositivo();
    const cMovil = await contexto(movil, remoto, salVieja, 'contraseña olvidada vieja');
    const cPc = await contexto(pc, remoto, salVieja, 'contraseña olvidada vieja');
    await guardarGasto({ ...gasto(10), id: 'del-movil' }, movil);
    await sincronizar(cMovil);
    await sincronizar(cPc);
    await guardarGasto({ ...gasto(20), id: 'del-pc-sin-subir' }, pc);

    const salNueva = generarSal();
    const nueva = { clave: await derivarClave('contraseña nueva de verdad', salNueva, IT), sal: salNueva, iteraciones: IT };
    await guardarGasto({ ...gasto(30), id: 'del-movil-reciente' }, movil);
    await recifrar(movil, remoto, { clave: cMovil.clave, sal: salVieja, iteraciones: IT }, nueva);

    // El PC, con la clave vieja, ya no puede sincronizar: se le pide la nueva.
    await expect(sincronizar(cPc)).rejects.toMatchObject({ motivo: 'clave-cambiada' });
    // Con la nueva, sincroniza y conserva lo que tenía pendiente.
    await sincronizar({ ...cPc, ...nueva });
    await sincronizar({ ...cMovil, ...nueva });
    for (const base of [movil, pc]) {
      expect((await leerTodo(base)).gastos.map((g) => g.id).sort()).toEqual(['del-movil', 'del-movil-reciente', 'del-pc-sin-subir']);
    }
    // La contraseña antigua ya no descifra nada.
    await expect(sincronizar(await contexto(await dispositivo(), remoto, salNueva, 'contraseña olvidada vieja'))).rejects.toThrow(/contraseña/);
  });

  it('si otro dispositivo sube durante el cambio, se repite y el resultado queda cifrado con la nueva', async () => {
    const { recifrar } = await import('./motor');
    const remoto = new RemotoMemoria();
    const sal = generarSal();
    const a = await dispositivo();
    const b = await dispositivo();
    const ca = await contexto(a, remoto, sal);
    const cb = await contexto(b, remoto, sal);
    await sincronizar(ca);
    await sincronizar(cb);
    await guardarGasto({ ...gasto(5), id: 'de-b' }, b);
    const salNueva = generarSal();
    const nueva = { clave: await derivarClave('otra frase nueva larga', salNueva, IT), sal: salNueva, iteraciones: IT };
    let veces = 0;
    // Justo cuando a va a subir lo re-cifrado, b sube con la clave antigua.
    const escribirOriginal = remoto.escribir.bind(remoto);
    remoto.escribir = async (t, s) => {
      if (t.includes(salNueva) && veces++ === 0) await sincronizar(cb);
      return escribirOriginal(t, s);
    };
    await recifrar(a, remoto, { clave: ca.clave, sal, iteraciones: IT }, nueva);
    expect(veces).toBeGreaterThan(1);
    await sincronizar({ ...ca, ...nueva });
    expect((await leerTodo(a)).gastos.map((g) => g.id)).toContain('de-b');
  });

  it('empezar de cero: sustituye GitHub por los datos de este dispositivo con contraseña nueva', async () => {
    const { sobrescribirRemoto } = await import('./motor');
    const remoto = new RemotoMemoria();
    const a = await dispositivo();
    await guardarGasto({ ...gasto(1), id: 'solo-en-remoto' }, a);
    await sincronizar(await contexto(a, remoto, generarSal(), 'contraseña que nadie recuerda'));
    const b = await dispositivo();
    await guardarGasto({ ...gasto(2), id: 'datos-buenos' }, b);
    const sal = generarSal();
    const nueva = { clave: await derivarClave('empiezo de cero hoy', sal, IT), sal, iteraciones: IT };
    await sobrescribirRemoto(b, remoto, nueva);
    const c = await dispositivo();
    await sincronizar({ base: c, cliente: remoto, ...nueva, primeraVez: true });
    expect((await leerTodo(c)).gastos.map((g) => g.id)).toEqual(['datos-buenos']);
  });
});
