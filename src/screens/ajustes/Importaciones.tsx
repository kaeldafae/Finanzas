import { useState } from 'react';
import { deshacerImportacion } from '../../db/operaciones';
import { useEstado } from '../../estado';
import { formatearFecha } from '../../lib/fecha';
import { Aviso } from '../../ui/base';

/** Historial de importaciones con opción de deshacer cada una entera. */
export function Importaciones() {
  const { datos } = useEstado();
  const [mensaje, setMensaje] = useState<string | null>(null);
  if (datos.importaciones.length === 0) return null;

  async function deshacer(id: string, descripcion: string) {
    if (!window.confirm(`¿Deshacer la importación ${descripcion}? Se quitan todos sus movimientos (también en tus otros dispositivos). Las reglas aprendidas se conservan y podrás volver a importar el extracto.`)) return;
    const n = await deshacerImportacion(id);
    setMensaje(`Importación deshecha: ${n} movimientos quitados.`);
  }

  return (
    <>
      <h3 style={{ marginTop: 16 }}>Importaciones anteriores</h3>
      <ul className="lista">
        {datos.importaciones.slice(0, 10).map((i) => {
          const descripcion = `del ${formatearFecha(i.fecha)} (${i.cuentas.join(' + ')}, ${i.movimientos} movimientos)`;
          return (
            <li key={i.id} className="fila">
              <span className="principal">
                {i.cuentas.join(' + ')} · {i.movimientos} movimientos
                <span className="secundario" style={{ display: 'block' }}>
                  {formatearFecha(i.fecha)} · del {i.desde} al {i.hasta}{i.deshecha ? ' · deshecha' : ''}
                </span>
              </span>
              {!i.deshecha && <button type="button" className="btn compacto peligro" onClick={() => void deshacer(i.id, descripcion)}>Deshacer</button>}
            </li>
          );
        })}
      </ul>
      {mensaje && <Aviso tipo="info">{mensaje}</Aviso>}
    </>
  );
}
