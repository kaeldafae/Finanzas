import type { Tema } from '../domain/modelo';
import { borrarTodo, guardarAjustes } from '../db/operaciones';
import { useEstado } from '../estado';
import type { EstadoAlmacenamiento } from '../lib/almacenamiento';
import { Aviso, Segmentado } from '../ui/base';
import { Copias } from './ajustes/Copias';
import { Fiscal } from './ajustes/Fiscal';
import { Listas } from './ajustes/Listas';
import { Personales } from './ajustes/Personales';

function formatearBytes(b: number): string {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`;
}

export function PantallaAjustes({ almacenamiento }: { almacenamiento: EstadoAlmacenamiento | null }) {
  const { ajustes } = useEstado();

  async function borrar() {
    if (!window.confirm('¿Borrar TODOS los datos de este dispositivo? Exporta antes una copia si la quieres.')) return;
    if (!window.confirm('Última confirmación: se borrará todo y no se puede deshacer.')) return;
    await borrarTodo();
    window.location.reload();
  }

  return (
    <>
      <h1>Ajustes</h1>
      <Copias />
      <Personales />
      <Listas />
      <Fiscal />

      <section className="card" aria-labelledby="t-disp">
        <h2 id="t-disp">Dispositivo</h2>
        <Segmentado<Tema>
          etiqueta="Apariencia"
          valor={ajustes.tema}
          onCambio={(v) => void guardarAjustes({ tema: v })}
          opciones={[
            { valor: 'auto', texto: 'Automática' },
            { valor: 'claro', texto: 'Clara' },
            { valor: 'oscuro', texto: 'Oscura' },
          ]}
        />
        <p className="peq">
          Almacenamiento:{' '}
          <strong>
            {almacenamiento?.persistente === true
              ? 'persistente ✓'
              : almacenamiento?.persistente === false
                ? 'no persistente'
                : 'no se puede comprobar'}
          </strong>
          {almacenamiento?.usoBytes != null && ` · ${formatearBytes(almacenamiento.usoBytes)} usados`}
        </p>
        {almacenamiento?.persistente !== true && (
          <Aviso titulo="El navegador podría borrar los datos">
            {almacenamiento?.instalada
              ? 'Haz copias de seguridad con frecuencia.'
              : 'Instala la app en la pantalla de inicio: en iPhone, Safari puede borrar los datos de las webs no instaladas tras 7 días sin abrirlas.'}
          </Aviso>
        )}
        <p className="peq muted">
          Sin servidores, sin cuentas y sin analítica: los datos no salen de este dispositivo salvo cuando tú exportas una copia.
        </p>
        <button type="button" className="btn peligro bloque" onClick={() => void borrar()}>Borrar todos los datos</button>
      </section>
    </>
  );
}
