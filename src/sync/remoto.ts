import { aBase64, deBase64 } from '../domain/cifrado';

export interface ArchivoRemoto {
  texto: string;
  /** Versión del archivo en el servidor; se envía al escribir para detectar escrituras simultáneas. */
  sha: string;
}

export type ResultadoEscritura = { ok: true; sha: string } | { ok: false; conflicto: true };

/** Almacén remoto mínimo: un único archivo con control de versión. */
export interface ClienteRemoto {
  leer(): Promise<ArchivoRemoto | null>;
  escribir(texto: string, sha: string | null): Promise<ResultadoEscritura>;
}

export type MotivoErrorRemoto = 'token' | 'permisos' | 'no-encontrado' | 'publico' | 'red' | 'limite' | 'otro';

export class ErrorRemoto extends Error {
  constructor(
    mensaje: string,
    readonly motivo: MotivoErrorRemoto,
  ) {
    super(mensaje);
    this.name = 'ErrorRemoto';
  }
}

export const RUTA_ARCHIVO = 'finanzas.sync.json';
const API = 'https://api.github.com';

/** "usuario/repositorio" con caracteres válidos en GitHub. */
export function validarRepo(repo: string): string | null {
  return /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo.trim()) ? null : 'Escribe usuario/repositorio, por ejemplo: kaeldafae/finanzas-datos';
}

function textoAUtf8Base64(texto: string): string {
  return aBase64(new TextEncoder().encode(texto));
}

function utf8Base64ATexto(b64: string): string {
  return new TextDecoder().decode(deBase64(b64));
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Cliente de la API de contenidos de GitHub. Solo habla con api.github.com
 * (la CSP de la app no permite ningún otro destino).
 */
export class ClienteGitHub implements ClienteRemoto {
  private readonly repo: string;

  constructor(
    repo: string,
    private readonly token: string,
    private readonly ruta = RUTA_ARCHIVO,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {
    this.repo = repo.trim();
  }

  private async peticion(url: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    let r: Response;
    try {
      r = await this.fetchFn(url, {
        ...init,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: accept,
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new ErrorRemoto('Sin conexión con GitHub.', 'red');
    }
    if (r.status === 401) throw new ErrorRemoto('GitHub ha rechazado el token: puede haber caducado o ser incorrecto.', 'token');
    if (r.status === 403 || r.status === 429) {
      const sinCupo = r.headers.get('x-ratelimit-remaining') === '0' || r.status === 429;
      throw sinCupo
        ? new ErrorRemoto('GitHub ha limitado las peticiones temporalmente. Se reintentará más tarde.', 'limite')
        : new ErrorRemoto('El token no tiene permiso de escritura en el repositorio (Contents: Read and write).', 'permisos');
    }
    return r;
  }

  private urlArchivo(): string {
    return `${API}/repos/${this.repo}/contents/${encodeURIComponent(this.ruta)}`;
  }

  /** Comprueba que el repositorio existe, es accesible con el token y es PRIVADO. */
  async verificarRepo(): Promise<void> {
    const r = await this.peticion(`${API}/repos/${this.repo}`);
    if (r.status === 404) throw new ErrorRemoto('No encuentro el repositorio o el token no tiene acceso a él.', 'no-encontrado');
    if (!r.ok) throw new ErrorRemoto(`GitHub respondió ${r.status} al comprobar el repositorio.`, 'otro');
    const json: unknown = await r.json();
    if (!esObjeto(json) || json['private'] !== true) {
      throw new ErrorRemoto('El repositorio es público. Por seguridad, la sincronización solo funciona con un repositorio privado.', 'publico');
    }
  }

  async leer(): Promise<ArchivoRemoto | null> {
    const r = await this.peticion(this.urlArchivo());
    if (r.status === 404) return null;
    if (!r.ok) throw new ErrorRemoto(`GitHub respondió ${r.status} al leer los datos.`, 'otro');
    const json: unknown = await r.json();
    if (!esObjeto(json) || typeof json['sha'] !== 'string') throw new ErrorRemoto('Respuesta inesperada de GitHub.', 'otro');
    const sha = json['sha'];
    const contenido = typeof json['content'] === 'string' ? json['content'] : '';
    if (contenido !== '') return { sha, texto: utf8Base64ATexto(contenido) };
    // Archivos de más de 1 MB: la API no incluye el contenido y hay que pedirlo en bruto.
    const bruto = await this.peticion(this.urlArchivo(), {}, 'application/vnd.github.raw+json');
    if (!bruto.ok) throw new ErrorRemoto(`GitHub respondió ${bruto.status} al leer los datos.`, 'otro');
    return { sha, texto: await bruto.text() };
  }

  async escribir(texto: string, sha: string | null): Promise<ResultadoEscritura> {
    const r = await this.peticion(this.urlArchivo(), {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Sincronización cifrada',
        content: textoAUtf8Base64(texto),
        ...(sha ? { sha } : {}),
      }),
    });
    // 409: el archivo cambió entre la lectura y la escritura. 422: falta o no coincide el sha.
    if (r.status === 409 || r.status === 422) return { ok: false, conflicto: true };
    if (r.status === 404) throw new ErrorRemoto('No encuentro el repositorio o el token no tiene acceso a él.', 'no-encontrado');
    if (!r.ok) throw new ErrorRemoto(`GitHub respondió ${r.status} al guardar los datos.`, 'otro');
    const json: unknown = await r.json();
    const contenido = esObjeto(json) ? json['content'] : null;
    if (!esObjeto(contenido) || typeof contenido['sha'] !== 'string') throw new ErrorRemoto('Respuesta inesperada de GitHub.', 'otro');
    return { ok: true, sha: contenido['sha'] };
  }
}
