import { useId, useState, type SubmitEvent } from 'react';
import { validarContrasena } from '../../domain/cifrado';
import { exportarCopia, leerTodo } from '../../db/operaciones';
import { descargarBlob } from '../../lib/descarga';
import { fechaArchivo, formatearFecha } from '../../lib/fecha';
import { validarRepo } from '../../sync/remoto';
import {
  cambiarToken,
  comprobarRepo,
  conectar,
  describirError,
  desconectar,
  reintroducirContrasena,
  sincronizarAhora,
  useEstadoSync,
  type FaseSync,
} from '../../sync/servicio';
import { Aviso, CampoTexto } from '../../ui/base';

function CampoSecreto({ etiqueta, valor, onCambio, error, nueva = false, ayuda }: { etiqueta: string; valor: string; onCambio: (v: string) => void; error?: string | undefined; nueva?: boolean; ayuda?: string }) {
  const id = useId();
  const [ver, setVer] = useState(false);
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
        <input
          id={id}
          type={ver ? 'text' : 'password'}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          autoComplete={nueva ? 'new-password' : 'current-password'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : ayuda ? `${id}-a` : undefined}
        />
        <button type="button" className="btn compacto" onClick={() => setVer(!ver)} aria-pressed={ver} aria-label={ver ? `Ocultar ${etiqueta}` : `Mostrar ${etiqueta}`}>
          {ver ? 'Ocultar' : 'Ver'}
        </button>
      </div>
      {ayuda && !error && <span id={`${id}-a`} className="ayuda">{ayuda}</span>}
      {error && <span id={`${id}-e`} className="error">{error}</span>}
    </div>
  );
}

const TEXTO_FASE: Record<FaseSync, string> = {
  cargando: 'Cargando…',
  desactivada: 'Desactivada',
  'al-dia': 'Sincronizado ✓',
  sincronizando: 'Sincronizando…',
  'sin-conexion': 'Sin conexión: se sincronizará al volver la red',
  error: 'Error',
};

function mensajeError(e: unknown): string {
  return describirError(e).mensaje;
}

function Alta() {
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [existe, setExiste] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intentado, setIntentado] = useState(false);

  const errRepo = validarRepo(repo) ?? undefined;
  const errToken = token.trim().length < 20 ? 'Pega el token completo (empieza por github_pat_)' : undefined;
  const errContrasena = existe === null ? undefined : (validarContrasena(contrasena, existe ? undefined : confirmacion) ?? undefined);

  async function comprobar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setIntentado(true);
    setError(null);
    if (errRepo || errToken) return;
    setOcupado('Comprobando el repositorio…');
    try {
      const r = await comprobarRepo(repo.trim(), token.trim());
      setExiste(r.existe);
      setIntentado(false);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setOcupado(null);
    }
  }

  async function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setIntentado(true);
    setError(null);
    if (errContrasena) return;
    try {
      const local = await leerTodo();
      if (existe && local.ingresos.length + local.gastos.length + local.extras.length > 0) {
        // Antes de mezclar con los datos de otro dispositivo, copia de seguridad de lo que hay aquí.
        setOcupado('Guardando copia de seguridad de este dispositivo…');
        const copia = await exportarCopia();
        descargarBlob(new Blob([JSON.stringify(copia, null, 2)], { type: 'application/json' }), `finanzas-antes-de-sincronizar-${fechaArchivo()}.json`);
      }
      setOcupado('Cifrando y conectando… (unos segundos)');
      await conectar({ repo: repo.trim(), token: token.trim(), contrasena });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setOcupado(null);
    }
  }

  if (existe === null) {
    return (
      <form onSubmit={(e) => void comprobar(e)} noValidate>
        <CampoTexto etiqueta="Repositorio privado" valor={repo} onCambio={setRepo} placeholder="usuario/finanzas-datos" error={intentado ? errRepo : undefined} ayuda="Tu usuario de GitHub, barra y el nombre del repositorio privado." />
        <CampoSecreto etiqueta="Token de GitHub" valor={token} onCambio={setToken} error={intentado ? errToken : undefined} ayuda="Fine-grained, solo para ese repositorio, con Contents: Read and write." />
        {error && <Aviso>{error}</Aviso>}
        <button type="submit" className="btn primario bloque" disabled={ocupado !== null}>{ocupado ?? 'Comprobar'}</button>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void enviar(e)} noValidate>
      <Aviso tipo="info" titulo={existe ? 'Ya hay datos sincronizados' : 'Primera vez'}>
        {existe
          ? 'Escribe la misma contraseña de cifrado que usaste en tu otro dispositivo. Los datos de aquí se combinarán con los de allí, sin duplicar.'
          : 'Elige la contraseña de cifrado. Usarás la misma en todos tus dispositivos. Si la pierdes, los datos guardados en GitHub no se pueden recuperar.'}
      </Aviso>
      <CampoSecreto etiqueta="Contraseña de cifrado" valor={contrasena} onCambio={setContrasena} nueva={!existe} error={intentado ? errContrasena : undefined} ayuda="Mínimo 10 caracteres. Mejor una frase de varias palabras." />
      {!existe && <CampoSecreto etiqueta="Repite la contraseña" valor={confirmacion} onCambio={setConfirmacion} nueva />}
      {error && <Aviso>{error}</Aviso>}
      <div className="botones">
        <button type="button" className="btn" onClick={() => { setExiste(null); setError(null); }} disabled={ocupado !== null}>Atrás</button>
        <button type="submit" className="btn primario" disabled={ocupado !== null}>{ocupado ?? 'Conectar'}</button>
      </div>
    </form>
  );
}

function Reparar({ accion }: { accion: 'token' | 'contrasena' }) {
  const [valor, setValor] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      if (accion === 'token') await cambiarToken(valor);
      else await reintroducirContrasena(valor);
      setValor('');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={(e) => void enviar(e)} noValidate>
      <CampoSecreto
        etiqueta={accion === 'token' ? 'Token nuevo de GitHub' : 'Contraseña de cifrado'}
        valor={valor}
        onCambio={setValor}
        ayuda={accion === 'token' ? 'Genera uno nuevo en GitHub con los mismos permisos y pégalo aquí.' : 'La que usas en tus otros dispositivos.'}
      />
      {error && <Aviso>{error}</Aviso>}
      <button type="submit" className="btn primario bloque" disabled={ocupado || valor.length === 0}>{ocupado ? 'Comprobando…' : 'Guardar'}</button>
    </form>
  );
}

export function Sincronizacion() {
  const e = useEstadoSync();

  async function quitar() {
    if (!window.confirm('¿Dejar de sincronizar este dispositivo? Sus datos se quedan aquí y los de GitHub no se borran.')) return;
    await desconectar();
  }

  return (
    <section className="card" aria-labelledby="t-sync">
      <h2 id="t-sync">Sincronización</h2>
      {e.fase === 'desactivada' && (
        <>
          <p className="peq muted">
            Mantén los mismos datos en el móvil y el ordenador. Se guardan <strong>cifrados de extremo a extremo</strong> en un repositorio privado de tu GitHub: GitHub solo ve datos ilegibles y la contraseña nunca sale de tus dispositivos.
          </p>
          <Alta />
        </>
      )}
      {e.fase !== 'desactivada' && e.fase !== 'cargando' && (
        <>
          <p aria-live="polite">
            <strong className={e.fase === 'error' ? 'neg' : e.fase === 'al-dia' ? 'pos' : ''}>{TEXTO_FASE[e.fase]}</strong>
          </p>
          <p className="peq muted">
            Repositorio: <strong>{e.repo}</strong>
            <br />
            Última sincronización: {e.ultimaSync ? `${formatearFecha(e.ultimaSync)}, ${new Date(e.ultimaSync).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'pendiente'}
          </p>
          {e.error && <Aviso titulo="No se ha podido sincronizar">{e.error}</Aviso>}
          {e.accion && <Reparar key={e.accion} accion={e.accion} />}
          <div className="botones">
            <button type="button" className="btn" onClick={() => void sincronizarAhora()} disabled={e.fase === 'sincronizando'}>Sincronizar ahora</button>
            <button type="button" className="btn peligro" onClick={() => void quitar()}>Desconectar</button>
          </div>
          <p className="peq muted" style={{ marginTop: 10 }}>
            Se sincroniza al abrir la app, unos segundos después de cada cambio y cada 2 minutos mientras está abierta. Sin conexión puedes seguir usándola: los cambios se envían al volver la red.
          </p>
        </>
      )}
    </section>
  );
}
