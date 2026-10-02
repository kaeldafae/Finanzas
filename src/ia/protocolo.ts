import type { MensajeIA } from '../domain/importacion/iaLocal';

/**
 * Mensajes entre la app y el worker de la IA. La librería WebLLM solo vive en el worker: el hilo
 * principal no la descarga (ahorra ~6 MB) y la interfaz no se congela mientras el modelo trabaja.
 */
export type PeticionIA =
  | { id: number; tipo: 'enCache'; modelo: string }
  | { id: number; tipo: 'borrar'; modelo: string }
  | { id: number; tipo: 'cargar'; modelo: string }
  | { id: number; tipo: 'generar'; mensajes: MensajeIA[]; esquema: string; maxTokens: number; sinRazonar: boolean }
  | { id: number; tipo: 'descargar' }
  | { id: 0; tipo: 'interrumpir' };

export type RespuestaIA =
  | { id: number; tipo: 'ok'; valor: unknown }
  | { id: number; tipo: 'error'; error: string }
  | { id: number; tipo: 'progreso'; progreso: number; texto: string };
