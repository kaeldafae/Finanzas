// Hilo aparte donde se ejecuta el modelo: la interfaz no se congela mientras la IA piensa.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (mensaje: MessageEvent) => {
  handler.onmessage(mensaje);
};
