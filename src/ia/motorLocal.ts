import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import type { MensajeIA, MotorIA } from '../domain/importacion/iaLocal';

/**
 * IA integrada: un modelo de lenguaje que se ejecuta en el propio dispositivo con WebGPU.
 * Solo se descarga el modelo (una vez, de los servidores de MLC/Hugging Face). Tus movimientos
 * nunca salen del dispositivo: la inferencia es local.
 */

export interface ModeloIA {
  id: string;
  nombre: string;
  descarga: string;
  recomendadoPara: string;
}

const LIGERO: ModeloIA = { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', nombre: 'Ligero (Qwen2.5 0,5B)', descarga: '≈ 300 MB', recomendadoPara: 'iPhone y móviles' };
const PRECISO: ModeloIA = { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', nombre: 'Preciso (Qwen2.5 1,5B)', descarga: '≈ 900 MB', recomendadoPara: 'ordenador' };

export const MODELOS: readonly ModeloIA[] = [LIGERO, PRECISO];

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

export async function modeloDescargado(id: string): Promise<boolean> {
  try {
    // El motor no se precarga: sin conexión y sin haberlo usado nunca, el import falla.
    const webllm = await import('@mlc-ai/web-llm');
    return await webllm.hasModelInCache(id, webllm.prebuiltAppConfig);
  } catch {
    return false;
  }
}

export async function borrarModelo(id: string): Promise<void> {
  const webllm = await import('@mlc-ai/web-llm');
  await webllm.deleteModelAllInfoInCache(id, webllm.prebuiltAppConfig);
  if (motorActual?.id === id) await descargarMotor();
}

let motorActual: { id: string; engine: WebWorkerMLCEngine } | null = null;

export async function descargarMotor(): Promise<void> {
  const m = motorActual;
  motorActual = null;
  if (m) await m.engine.unload();
}

export interface ProgresoCarga {
  progreso: number;
  texto: string;
}

/** Carga (y la primera vez descarga) el modelo. Reutiliza el motor si ya está cargado. */
export async function cargarMotor(id: string, alProgresar?: (p: ProgresoCarga) => void): Promise<MotorIA> {
  if (motorActual?.id !== id) {
    await descargarMotor();
    const webllm = await import('@mlc-ai/web-llm');
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    try {
      const engine = await webllm.CreateWebWorkerMLCEngine(worker, id, {
        appConfig: webllm.prebuiltAppConfig,
        initProgressCallback: (r) => alProgresar?.({ progreso: r.progress, texto: r.text }),
      });
      motorActual = { id, engine };
    } catch (e) {
      worker.terminate();
      throw new Error(traducirError(e), { cause: e });
    }
  }
  const engine = (motorActual as { engine: WebWorkerMLCEngine }).engine;
  return {
    async generar(mensajes: MensajeIA[], esquema: string): Promise<string> {
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      const limite = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => {
          engine.interruptGenerate();
          rechazar(new Error('la IA tardó demasiado'));
        }, 120_000);
      });
      const respuesta = engine.chat.completions.create({
        messages: mensajes,
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object', schema: esquema },
      });
      let r: Awaited<typeof respuesta>;
      try {
        r = await Promise.race([respuesta, limite]);
      } finally {
        // Sin esto, el temporizador de un lote ya terminado cortaría el lote siguiente.
        clearTimeout(temporizador);
      }
      const eleccion = r.choices[0];
      if (!eleccion) throw new Error('respuesta vacía');
      // Cortada por longitud: se devuelve igual y la validación la rechazará como incompleta.
      return eleccion.message.content ?? '';
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
