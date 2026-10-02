import { useEffect, useState } from 'react';
import { Aviso, Barra, Selector } from '../../ui/base';

type Modulo = typeof import('../../ia/motorLocal');

/** Gestión de la IA integrada: comprobar compatibilidad, descargar, probar y borrar el modelo. */
export function IAIntegrada() {
  const [mod, setMod] = useState<Modulo | null>(null);
  const [soporte, setSoporte] = useState<{ ok: boolean; motivo?: string } | null>(null);
  const [modelo, setModelo] = useState<string>('');
  const [descargado, setDescargado] = useState<boolean | null>(null);
  const [progreso, setProgreso] = useState<{ p: number; t: string } | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    void import('../../ia/motorLocal').then(async (m) => {
      const s = await m.comprobarSoporte();
      const elegido = m.modeloElegido().id;
      const d = s.ok ? await m.modeloDescargado(elegido) : false;
      if (!vivo) return;
      setMod(m);
      setSoporte(s);
      setModelo(elegido);
      setDescargado(d);
    }).catch(() => {
      if (vivo) setSoporte({ ok: false, motivo: 'No se pudo cargar el módulo de IA (¿sin conexión?). Vuelve a abrir Ajustes con conexión.' });
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function cambiarModelo(id: string) {
    if (!mod) return;
    mod.elegirModelo(id);
    setModelo(id);
    setMensaje(null);
    setDescargado(await mod.modeloDescargado(id));
  }

  async function probar() {
    if (!mod) return;
    setMensaje(null);
    setProgreso({ p: 0, t: 'Preparando…' });
    try {
      const r = await mod.diagnostico(modelo, (x) => setProgreso({ p: x.progreso, t: x.texto }));
      setDescargado(true);
      setMensaje(
        r.correcto
          ? { tipo: 'ok', texto: `Funciona: ha clasificado bien un comercio de prueba en ${r.segundos.toLocaleString('es-ES')} s. Ya puedes usarla al importar extractos.` }
          : { tipo: 'error', texto: `La IA respondió, pero no acertó el comercio de prueba (${r.respuesta.slice(0, 120)}). Prueba el modelo preciso o usa la revisión por copiar y pegar.` },
      );
    } catch (e) {
      setMensaje({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setProgreso(null);
    }
  }

  async function borrar() {
    if (!mod || !window.confirm('¿Borrar el modelo de este dispositivo? Podrás volver a descargarlo cuando quieras.')) return;
    await mod.borrarModelo(modelo);
    setDescargado(false);
    setMensaje({ tipo: 'ok', texto: 'Modelo borrado.' });
  }

  return (
    <section className="card" aria-labelledby="t-ia-int">
      <h2 id="t-ia-int">IA integrada</h2>
      <p className="peq muted">
        Un modelo de IA que funciona dentro de la app, en este dispositivo y sin conexión. Solo se descarga el modelo una vez; tus movimientos nunca salen del dispositivo. Al importar extractos revisa los comercios dudosos dos veces y solo propone lo que coincide; tú confirmas.
      </p>
      {!soporte && <p className="peq" role="status">Comprobando el dispositivo…</p>}
      {soporte && !soporte.ok && (
        <Aviso titulo="Este dispositivo no puede ejecutar la IA integrada">
          {soporte.motivo} Mientras tanto, al importar puedes usar la revisión con IA por copiar y pegar.
        </Aviso>
      )}
      {soporte?.ok && mod && (
        <>
          <Selector etiqueta="Modelo" valor={modelo} onCambio={(v) => void cambiarModelo(v)}>
            {mod.MODELOS.map((m) => <option key={m.id} value={m.id}>{m.nombre} · memoria {m.memoria} · {m.recomendadoPara}</option>)}
          </Selector>
          <p className="peq">Estado: <strong>{descargado === null ? '…' : descargado ? 'descargado en este dispositivo ✓' : 'sin descargar'}</strong></p>
          {progreso && (
            <div role="status" aria-live="polite">
              <Barra valor={Math.round(progreso.p * 10_000)} etiqueta="Carga de la IA" />
              <p className="peq muted">{progreso.t}</p>
            </div>
          )}
          {mensaje && (mensaje.tipo === 'ok' ? <Aviso tipo="info">{mensaje.texto}</Aviso> : <Aviso>{mensaje.texto}</Aviso>)}
          <div className="botones">
            <button type="button" className="btn primario" disabled={progreso !== null} onClick={() => void probar()}>
              {descargado ? 'Probar la IA' : 'Descargar y probar'}
            </button>
            {descargado && <button type="button" className="btn peligro" disabled={progreso !== null} onClick={() => void borrar()}>Borrar modelo</button>}
          </div>
          {!descargado && <p className="peq muted">La descarga es grande: hazla con wifi. Queda guardada para usarla sin conexión.</p>}
        </>
      )}
    </section>
  );
}
