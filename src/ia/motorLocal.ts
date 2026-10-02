import type { MensajeIA, MotorIA } from '../domain/importacion/iaLocal';
import type { PeticionIA, RespuestaIA } from './protocolo';

/**
 * IA integrada: un modelo de lenguaje que se ejecuta en el propio dispositivo con WebGPU, dentro de un
 * worker. Solo se descarga el modelo (una vez, de los servidores de MLC/Hugging Face). Tus movimientos
 * nunca salen del dispositivo: la inferencia es local.
 */

export interface ModeloIA {
  id: string;
  nombre: string;
  /** Memoria de vídeo que necesita según la configuración de WebLLM. */
  memoria: string;
  recomendadoPara: string;
  /** Qwen3 razona antes de responder: se desactiva para respuestas cortas en JSON. */
  sinRazonar?: boolean;
}

const LIGERO: ModeloIA = { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', nombre: 'Ligero (Qwen2.5 0,5B)', memoria: '≈ 945 MB', recomendadoPara: 'iPhone y móviles' };
const PRECISO: ModeloIA = { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', nombre: 'Preciso (Qwen2.5 1,5B)', memoria: '≈ 1,6 GB', recomendadoPara: 'ordenador' };

export const MODELOS: readonly ModeloIA[] = [
  LIGERO,
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', nombre: 'Llama 3.2 1B', memoria: '≈ 880 MB', recomendadoPara: 'móviles (a probar con tus datos)' },
  { id: 'Qwen3-0.6B-q4f16_1-MLC', nombre: 'Qwen3 0,6B', memoria: '≈ 1,4 GB', recomendadoPara: 'móviles recientes (a probar)', sinRazonar: true },
  PRECISO,
];

const CLAVE_MODELO = 'finanzas.modeloIA';

function esMovil(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export function modeloElegido(): ModeloIA {
  let guardado: string | null = null;
  try {
    guardado = localStorage.getItem(CLAVE_MODELO);
  } catch {
    // Sin almacenamiento local: se usa el recomendado.
  }
  return MODELOS.find((m) => m.id === guardado) ?? (esMovil() ? LIGERO : PRECISO);
}

export function elegirModelo(id: string): void {
  try {
    localStorage.setItem(CLAVE_MODELO, id);
  } catch {
    // Ignorable: solo es una preferencia.
  }
}

export type Soporte = { ok: true } | { ok: false; motivo: string };

/** Comprueba si el navegador puede ejecutar la IA (WebGPU). */
export async function comprobarSoporte(): Promise<Soporte> {
  // Navigator ya declara gpu como obligatorio, pero en Safari/Firefox antiguos no existe.
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) {
    return { ok: false, motivo: 'Este navegador no tiene WebGPU. En el ordenador usa Chrome o Edge actualizados; en iPhone hace falta iOS 26 o posterior.' };
  }
  try {
    const adaptador = await gpu.requestAdapter();
    if (!adaptador) return { ok: false, motivo: 'El dispositivo no ofrece una GPU compatible con WebGPU.' };
  } catch {
    return { ok: false, motivo: 'No se pudo acceder a la GPU del dispositivo.' };
  }
  return { ok: true };
}

// --- Comunicación con el worker -----------------------------------------------------------------

let worker: Worker | null = null;
let siguienteId = 1;
const pendientes = new Map<number, { resolver: (v: unknown) => void; rechazar: (e: Error) => void; progreso?: (p: ProgresoCarga) => void }>();
let modeloCargado: string | null = null;

function obtenerWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<RespuestaIA>) => {
    const r = e.data;
    const p = pendientes.get(r.id);
    if (!p) return;
    if (r.tipo === 'progreso') p.progreso?.({ progreso: r.progreso, texto: r.texto });
    else {
      pendientes.delete(r.id);
      if (r.tipo === 'ok') p.resolver(r.valor);
      else p.rechazar(new Error(r.error));
    }
  };
  w.onerror = (e) => {
    // El worker no ha podido arrancar (sin conexión la primera vez, o el navegador lo ha cerrado).
    for (const p of pendientes.values()) p.rechazar(new Error(e.message || 'No se pudo iniciar la IA.'));
    pendientes.clear();
    w.terminate();
    worker = null;
    modeloCargado = null;
  };
  worker = w;
  return w;
}

type SinId<T> = T extends unknown ? Omit<T, 'id'> : never;

function pedir(p: SinId<Exclude<PeticionIA, { tipo: 'interrumpir' }>>, progreso?: (p: ProgresoCarga) => void): Promise<unknown> {
  const id = siguienteId++;
  return new Promise((resolver, rechazar) => {
    pendientes.set(id, { resolver, rechazar, ...(progreso ? { progreso } : {}) });
    obtenerWorker().postMessage({ ...p, id });
  });
}

/**
 * ¿Está el modelo ya en este dispositivo? Se mira directamente la caché del navegador donde WebLLM
 * guarda los pesos ("webllm/model"), sin arrancar el worker: abrir Ajustes no descarga nada.
 */
export async function modeloDescargado(id: string): Promise<boolean> {
  try {
    if (!(await caches.has('webllm/model'))) return false;
    const claves = await (await caches.open('webllm/model')).keys();
    return claves.some((r) => r.url.includes(`/${id}/`) && r.url.endsWith('tensor-cache.json'));
  } catch {
    return false;
  }
}

export async function borrarModelo(id: string): Promise<void> {
  await pedir({ tipo: 'borrar', modelo: id });
  if (modeloCargado === id) modeloCargado = null;
}

export async function descargarMotor(): Promise<void> {
  if (!worker) return;
  await pedir({ tipo: 'descargar' });
  modeloCargado = null;
}

export interface ProgresoCarga {
  progreso: number;
  texto: string;
}

/** Carga (y la primera vez descarga) el modelo. Reutiliza el que ya esté cargado. */
export async function cargarMotor(id: string, alProgresar?: (p: ProgresoCarga) => void): Promise<MotorIA> {
  if (modeloCargado !== id) {
    try {
      await pedir({ tipo: 'cargar', modelo: id }, alProgresar);
      modeloCargado = id;
    } catch (e) {
      throw new Error(traducirError(e), { cause: e });
    }
  }
  const sinRazonar = MODELOS.find((m) => m.id === id)?.sinRazonar === true;
  return {
    async generar(mensajes: MensajeIA[], esquema: string): Promise<string> {
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      const limite = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => {
          worker?.postMessage({ id: 0, tipo: 'interrumpir' } satisfies PeticionIA);
          rechazar(new Error('la IA tardó demasiado'));
        }, 120_000);
      });
      try {
        const r = await Promise.race([pedir({ tipo: 'generar', mensajes, esquema, maxTokens: 700, sinRazonar }), limite]);
        // Cortada por longitud: se devuelve igual y la validación la rechazará como incompleta.
        return typeof r === 'string' ? r : '';
      } finally {
        // Sin esto, el temporizador de un lote ya terminado cortaría el lote siguiente.
        clearTimeout(temporizador);
      }
    },
  };
}

function traducirError(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e);
  if (/fetch|network|Failed to fetch|NetworkError/i.test(t)) return 'No se pudo descargar el modelo. Comprueba la conexión (mejor con wifi) e inténtalo de nuevo.';
  if (/quota|storage|QuotaExceeded/i.test(t)) return 'No hay espacio suficiente en el dispositivo para guardar el modelo.';
  if (/memory|OOM|out of memory|device lost/i.test(t)) return 'El dispositivo se quedó sin memoria. Prueba con el modelo ligero.';
  if (/WebGPU|gpu/i.test(t)) return 'La GPU del dispositivo no es compatible con la IA integrada.';
  return `No se pudo cargar la IA: ${t}`;
}

/** Prueba rápida para el diagnóstico: un comercio evidente, mide el tiempo. */
export async function diagnostico(id: string, alProgresar?: (p: ProgresoCarga) => void): Promise<{ correcto: boolean; segundos: number; respuesta: string }> {
  const { construirMensajes, esquemaRespuesta } = await import('../domain/importacion/iaLocal');
  const motor = await cargarMotor(id, alProgresar);
  const inicio = performance.now();
  const nombres = ['Comida', 'Restaurantes y bares', 'Transporte', 'Otros'];
  const respuesta = await motor.generar(
    construirMensajes([{ n: 1, comercio: 'Mercadona', veces: 3, rango: 'entre 10 y 50 €', sentido: 'gasto', ids: [] }], nombres, 1),
    esquemaRespuesta(nombres),
  );
  const segundos = Math.round((performance.now() - inicio) / 100) / 10;
  return { correcto: /"categoria"\s*:\s*"Comida"/.test(respuesta), segundos, respuesta };
}
