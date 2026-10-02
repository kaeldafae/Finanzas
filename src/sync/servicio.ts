import { useSyncExternalStore } from 'react';
import { derivarClave, descifrar, ErrorCifrado, generarSal, ITERACIONES_PBKDF2, leerSobre } from '../domain/cifrado';
import { alCambiarDatos, db, type ConfigSync } from '../db/db';
import { ErrorSync, recifrar, sincronizar, sobrescribirRemoto } from './motor';
import { ClienteGitHub, ErrorRemoto } from './remoto';

/*
 * Orquestación de la sincronización en el navegador: cuándo sincronizar, estado para la interfaz
 * y alta/baja del dispositivo. La lógica de fusión y cifrado está en motor.ts y domain/.
 */

export type FaseSync = 'cargando' | 'desactivada' | 'al-dia' | 'sincronizando' | 'sin-conexion' | 'error';

export type AccionError = 'token' | 'contrasena' | null;

export interface EstadoSync {
  fase: FaseSync;
  repo: string | null;
  ultimaSync: string | null;
  error: string | null;
  /** Qué tiene que hacer la persona para arreglarlo. */
  accion: AccionError;
}

let estado: EstadoSync = { fase: 'cargando', repo: null, ultimaSync: null, error: null, accion: null };
const suscriptores = new Set<() => void>();

function fijar(cambios: Partial<EstadoSync>): void {
  estado = { ...estado, ...cambios };
  for (const s of suscriptores) s();
}

export function useEstadoSync(): EstadoSync {
  return useSyncExternalStore(
    (cb) => {
      suscriptores.add(cb);
      return () => suscriptores.delete(cb);
    },
    () => estado,
  );
}

// --- Ejecución -----------------------------------------------------------------------------

const ESPERA_TRAS_CAMBIO = 3000;
const INTERVALO = 120_000;

let enCurso: Promise<void> | null = null;
let repetir = false;
let temporizador: ReturnType<typeof setTimeout> | undefined;
// Función para que el compilador no dé por fijo el valor tras el await.
const hayQueRepetir = () => repetir;

function describirError(e: unknown): { mensaje: string; accion: AccionError; fase: FaseSync } {
  if (e instanceof ErrorRemoto) {
    if (e.motivo === 'red') return { mensaje: e.message, accion: null, fase: 'sin-conexion' };
    return { mensaje: e.message, accion: e.motivo === 'token' || e.motivo === 'permisos' || e.motivo === 'no-encontrado' ? 'token' : null, fase: 'error' };
  }
  if (e instanceof ErrorCifrado) return { mensaje: e.message, accion: e.motivo === 'contrasena' ? 'contrasena' : null, fase: 'error' };
  if (e instanceof ErrorSync) return { mensaje: e.message, accion: e.motivo === 'clave-cambiada' ? 'contrasena' : null, fase: 'error' };
  return { mensaje: e instanceof Error ? e.message : String(e), accion: null, fase: 'error' };
}

async function ejecutarUnaVez(): Promise<void> {
  const config = await db.config.get('config');
  if (!config) {
    fijar({ fase: 'desactivada', repo: null, error: null, accion: null });
    return;
  }
  if (!navigator.onLine) {
    fijar({ fase: 'sin-conexion', error: null, accion: null });
    return;
  }
  fijar({ fase: 'sincronizando', repo: config.repo });
  try {
    await sincronizar({
      base: db,
      cliente: new ClienteGitHub(config.repo, config.token),
      clave: config.clave,
      sal: config.sal,
      iteraciones: config.iteraciones,
      primeraVez: config.ultimaSync === null,
    });
    const ultimaSync = new Date().toISOString();
    await db.config.update('config', { ultimaSync });
    fijar({ fase: 'al-dia', ultimaSync, error: null, accion: null });
  } catch (e) {
    const d = describirError(e);
    fijar({ fase: d.fase, error: d.mensaje, accion: d.accion });
  }
}

/** Sincroniza ya. Si ya hay una en curso, encadena otra al terminar (para no perder cambios recientes). */
export function sincronizarAhora(): Promise<void> {
  clearTimeout(temporizador);
  if (enCurso) {
    repetir = true;
    return enCurso;
  }
  enCurso = (async () => {
    do {
      repetir = false;
      await ejecutarUnaVez();
    } while (hayQueRepetir());
  })().finally(() => {
    enCurso = null;
  });
  return enCurso;
}

function programar(ms: number): void {
  if (estado.fase === 'desactivada' || estado.fase === 'cargando') return;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => void sincronizarAhora(), ms);
}

let iniciado = false;

/** Se llama una vez al arrancar la app. */
export function iniciarSync(): void {
  if (iniciado) return;
  iniciado = true;
  alCambiarDatos(() => programar(ESPERA_TRAS_CAMBIO));
  window.addEventListener('online', () => void sincronizarAhora());
  window.addEventListener('offline', () => estado.fase !== 'desactivada' && fijar({ fase: 'sin-conexion' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sincronizarAhora();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && estado.fase !== 'desactivada') void sincronizarAhora();
  }, INTERVALO);
  void db.config.get('config').then((c) => {
    fijar({ fase: c ? 'al-dia' : 'desactivada', repo: c?.repo ?? null, ultimaSync: c?.ultimaSync ?? null });
    if (c) void sincronizarAhora();
  });
}

// --- Alta, cambios y baja -------------------------------------------------------------------

export interface DatosConexion {
  repo: string;
  token: string;
  contrasena: string;
}

export type ResultadoComprobacion = { existe: true } | { existe: false };

/** Comprueba repositorio y token, y si ya hay datos sincronizados (para saber si pedir confirmación de contraseña). */
export async function comprobarRepo(repo: string, token: string): Promise<ResultadoComprobacion> {
  const cliente = new ClienteGitHub(repo, token);
  await cliente.verificarRepo();
  return { existe: (await cliente.leer()) !== null };
}

/**
 * Da de alta este dispositivo. Si ya hay datos en GitHub, la contraseña se comprueba descifrándolos
 * antes de guardar nada; si es la primera vez, se crea una sal nueva.
 */
export async function conectar({ repo, token, contrasena }: DatosConexion): Promise<void> {
  const cliente = new ClienteGitHub(repo, token);
  await cliente.verificarRepo();
  const archivo = await cliente.leer();
  let sal: string;
  let iteraciones: number;
  let clave: CryptoKey;
  if (archivo) {
    const sobre = leerSobre(archivo.texto);
    sal = sobre.kdf.sal;
    iteraciones = sobre.kdf.iteraciones;
    clave = await derivarClave(contrasena, sal, iteraciones);
    await descifrar(clave, sobre); // lanza ErrorCifrado si la contraseña no es la de los otros dispositivos
  } else {
    sal = generarSal();
    iteraciones = ITERACIONES_PBKDF2;
    clave = await derivarClave(contrasena, sal, iteraciones);
  }
  const config: ConfigSync = { id: 'config', repo: repo.trim(), token: token.trim(), sal, iteraciones, clave, ultimaSync: null };
  await db.config.put(config);
  fijar({ fase: 'al-dia', repo: config.repo, ultimaSync: null, error: null, accion: null });
  await sincronizarAhora();
}

export async function cambiarToken(token: string): Promise<void> {
  const config = await db.config.get('config');
  if (!config) return;
  await new ClienteGitHub(config.repo, token).verificarRepo();
  await db.config.update('config', { token: token.trim() });
  await sincronizarAhora();
}

/** Tras cambiar la contraseña en otro dispositivo, o si la guardada ya no sirve. */
export async function reintroducirContrasena(contrasena: string): Promise<void> {
  const config = await db.config.get('config');
  if (!config) return;
  const cliente = new ClienteGitHub(config.repo, config.token);
  const archivo = await cliente.leer();
  if (!archivo) throw new ErrorRemoto('No hay datos sincronizados en el repositorio.', 'no-encontrado');
  const sobre = leerSobre(archivo.texto);
  const clave = await derivarClave(contrasena, sobre.kdf.sal, sobre.kdf.iteraciones);
  await descifrar(clave, sobre);
  await db.config.update('config', { clave, sal: sobre.kdf.sal, iteraciones: sobre.kdf.iteraciones });
  await sincronizarAhora();
}

/**
 * Cambia la contraseña de cifrado desde un dispositivo ya conectado. No hace falta la antigua:
 * este dispositivo guarda la clave y con ella descifra y vuelve a cifrar todo con la nueva.
 */
export async function cambiarContrasena(nueva: string): Promise<void> {
  const config = await db.config.get('config');
  if (!config) throw new Error('Este dispositivo no está conectado.');
  clearTimeout(temporizador);
  if (enCurso) await enCurso;
  const sal = generarSal();
  const clave = await derivarClave(nueva, sal, ITERACIONES_PBKDF2);
  fijar({ fase: 'sincronizando', error: null, accion: null });
  try {
    await recifrar(
      db,
      new ClienteGitHub(config.repo, config.token),
      { clave: config.clave, sal: config.sal, iteraciones: config.iteraciones },
      { clave, sal, iteraciones: ITERACIONES_PBKDF2 },
    );
    const ultimaSync = new Date().toISOString();
    await db.config.update('config', { clave, sal, iteraciones: ITERACIONES_PBKDF2, ultimaSync });
    fijar({ fase: 'al-dia', ultimaSync, error: null, accion: null });
  } catch (e) {
    const d = describirError(e);
    fijar({ fase: d.fase, error: d.mensaje, accion: d.accion });
    throw e;
  }
}

/**
 * Si nadie recuerda la contraseña: sustituye lo que hay en GitHub por los datos de este dispositivo
 * cifrados con una contraseña nueva, y deja este dispositivo conectado.
 */
export async function empezarDeCero({ repo, token, contrasena }: DatosConexion): Promise<void> {
  const cliente = new ClienteGitHub(repo, token);
  await cliente.verificarRepo();
  const sal = generarSal();
  const clave = await derivarClave(contrasena, sal, ITERACIONES_PBKDF2);
  await sobrescribirRemoto(db, cliente, { clave, sal, iteraciones: ITERACIONES_PBKDF2 });
  const ultimaSync = new Date().toISOString();
  await db.config.put({ id: 'config', repo: repo.trim(), token: token.trim(), sal, iteraciones: ITERACIONES_PBKDF2, clave, ultimaSync });
  fijar({ fase: 'al-dia', repo: repo.trim(), ultimaSync, error: null, accion: null });
}

/** Deja de sincronizar ESTE dispositivo. Los datos locales y los de GitHub no se tocan. */
export async function desconectar(): Promise<void> {
  clearTimeout(temporizador);
  await db.config.delete('config');
  fijar({ fase: 'desactivada', repo: null, ultimaSync: null, error: null, accion: null });
}

export { describirError };
