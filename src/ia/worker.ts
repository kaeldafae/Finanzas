// Hilo aparte donde vive la IA: descarga, caché y ejecución del modelo con WebGPU.
import { deleteModelAllInfoInCache, MLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import type { PeticionIA, RespuestaIA } from './protocolo';

let motor: MLCEngine | null = null;
let idCarga = 0;

function enviar(r: RespuestaIA): void {
  self.postMessage(r);
}

function obtenerMotor(): MLCEngine {
  motor ??= new MLCEngine({
    appConfig: prebuiltAppConfig,
    initProgressCallback: (p) => enviar({ id: idCarga, tipo: 'progreso', progreso: p.progress, texto: p.text }),
  });
  return motor;
}

async function atender(p: Exclude<PeticionIA, { tipo: 'interrumpir' }>): Promise<unknown> {
  switch (p.tipo) {
    case 'borrar':
      await motor?.unload();
      await deleteModelAllInfoInCache(p.modelo, prebuiltAppConfig);
      return null;
    case 'cargar':
      idCarga = p.id;
      await obtenerMotor().reload(p.modelo);
      return null;
    case 'descargar':
      await motor?.unload();
      return null;
    case 'generar': {
      const r = await obtenerMotor().chat.completions.create({
        messages: p.mensajes,
        temperature: 0,
        max_tokens: p.maxTokens,
        response_format: { type: 'json_object', schema: p.esquema },
        ...(p.sinRazonar ? { extra_body: { enable_thinking: false } } : {}),
      });
      return r.choices[0]?.message.content ?? '';
    }
  }
}

self.onmessage = (e: MessageEvent<PeticionIA>) => {
  const p = e.data;
  if (p.tipo === 'interrumpir') {
    void motor?.interruptGenerate();
    return;
  }
  atender(p).then(
    (valor) => enviar({ id: p.id, tipo: 'ok', valor }),
    (err: unknown) => enviar({ id: p.id, tipo: 'error', error: err instanceof Error ? err.message : String(err) }),
  );
};
