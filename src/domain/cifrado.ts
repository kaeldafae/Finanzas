/**
 * Cifrado de extremo a extremo con la Web Crypto API (nativa en navegadores y en Node ≥ 20).
 *
 *  - Clave: PBKDF2-SHA256 sobre la contraseña, con sal aleatoria de 16 bytes.
 *  - Cifrado: AES-256-GCM (autenticado: detecta contraseña errónea y cualquier manipulación).
 *  - Antes de cifrar se comprime con gzip si el navegador lo permite.
 *
 * La contraseña y la clave nunca salen del dispositivo; al servidor solo llega el sobre cifrado.
 */

export const APP_SOBRE = 'finanzas-sync';
export const VERSION_SOBRE = 1;
/** Recomendación OWASP (2023) para PBKDF2-HMAC-SHA256. */
export const ITERACIONES_PBKDF2 = 600_000;
export const LONGITUD_MINIMA_CONTRASENA = 10;

export interface SobreCifrado {
  app: typeof APP_SOBRE;
  v: number;
  kdf: { alg: 'PBKDF2-SHA256'; iteraciones: number; sal: string };
  cifrado: { alg: 'AES-GCM'; iv: string };
  comp: 'gzip' | 'ninguna';
  datos: string;
  actualizadoEl: string;
}

export class ErrorCifrado extends Error {
  constructor(
    mensaje: string,
    readonly motivo: 'contrasena' | 'formato',
  ) {
    super(mensaje);
    this.name = 'ErrorCifrado';
  }
}

// --- Base64 sin dependencias, válido para binario ------------------------------------------

export function aBase64(bytes: Uint8Array): string {
  let binario = '';
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}

export function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const binario = atob(texto.replace(/\s/g, ''));
  const out = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) out[i] = binario.charCodeAt(i);
  return out;
}

const DATOS_ADICIONALES = new TextEncoder().encode(`${APP_SOBRE}:v${VERSION_SOBRE}`);

export function generarSal(): string {
  return aBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Deriva la clave AES. `extraible: false` impide sacarla del navegador aunque se guarde en IndexedDB. */
export async function derivarClave(contrasena: string, salB64: string, iteraciones = ITERACIONES_PBKDF2): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(contrasena.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deBase64(salB64), iterations: iteraciones },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function transformar(bytes: Uint8Array<ArrayBuffer>, flujo: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const salida = new Blob([bytes]).stream().pipeThrough(flujo);
  return new Uint8Array(await new Response(salida).arrayBuffer());
}

const hayCompresion = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export async function cifrar(
  clave: CryptoKey,
  texto: string,
  kdf: { sal: string; iteraciones: number },
  ahora = new Date(),
): Promise<SobreCifrado> {
  const plano = new TextEncoder().encode(texto);
  const comp = hayCompresion() ? 'gzip' : 'ninguna';
  const entrada = comp === 'gzip' ? await transformar(plano, new CompressionStream('gzip')) : plano;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: DATOS_ADICIONALES }, clave, entrada));
  return {
    app: APP_SOBRE,
    v: VERSION_SOBRE,
    kdf: { alg: 'PBKDF2-SHA256', iteraciones: kdf.iteraciones, sal: kdf.sal },
    cifrado: { alg: 'AES-GCM', iv: aBase64(iv) },
    comp,
    datos: aBase64(cifrado),
    actualizadoEl: ahora.toISOString(),
  };
}

export async function descifrar(clave: CryptoKey, sobre: SobreCifrado): Promise<string> {
  let plano: Uint8Array<ArrayBuffer>;
  try {
    plano = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: deBase64(sobre.cifrado.iv), additionalData: DATOS_ADICIONALES },
        clave,
        deBase64(sobre.datos),
      ),
    );
  } catch {
    throw new ErrorCifrado('La contraseña de cifrado no es correcta (o los datos están dañados).', 'contrasena');
  }
  if (sobre.comp === 'gzip') {
    if (!hayCompresion()) throw new ErrorCifrado('Este navegador no puede descomprimir los datos. Actualízalo.', 'formato');
    plano = await transformar(plano, new DecompressionStream('gzip'));
  }
  return new TextDecoder().decode(plano);
}

/** Valida la forma del sobre antes de intentar descifrarlo. */
export function leerSobre(texto: string): SobreCifrado {
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new ErrorCifrado('El archivo de sincronización no es JSON válido.', 'formato');
  }
  const o = json as Partial<SobreCifrado> | null;
  const valido =
    o !== null &&
    typeof o === 'object' &&
    o.app === APP_SOBRE &&
    typeof o.v === 'number' &&
    o.kdf?.alg === 'PBKDF2-SHA256' &&
    typeof o.kdf.sal === 'string' &&
    typeof o.kdf.iteraciones === 'number' &&
    o.kdf.iteraciones >= 1 &&
    o.cifrado?.alg === 'AES-GCM' &&
    typeof o.cifrado.iv === 'string' &&
    (o.comp === 'gzip' || o.comp === 'ninguna') &&
    typeof o.datos === 'string';
  if (!valido) throw new ErrorCifrado('El archivo de sincronización no tiene el formato esperado.', 'formato');
  const sobre = o as SobreCifrado;
  if (sobre.v > VERSION_SOBRE) throw new ErrorCifrado('Los datos se cifraron con una versión más nueva de la app. Actualízala.', 'formato');
  return sobre;
}

export function validarContrasena(contrasena: string, confirmacion?: string): string | null {
  if (contrasena.length < LONGITUD_MINIMA_CONTRASENA) return `Mínimo ${LONGITUD_MINIMA_CONTRASENA} caracteres. Mejor una frase de varias palabras.`;
  if (confirmacion !== undefined && contrasena !== confirmacion) return 'Las contraseñas no coinciden.';
  return null;
}
