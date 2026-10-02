import { useRef, useState } from 'react';
import { leerCopia, type CopiaSeguridad } from '../../domain/copia';
import { calcularIRPF } from '../../domain/irpf';
import { hojasAnio } from '../../domain/excel';
import { prepararRenta } from '../../domain/renta';
import { serieMeses } from '../../domain/resumen';
import { exportarCopia, guardarAjustes, importarCopia } from '../../db/operaciones';
import { useEstado } from '../../estado';
import { descargarBlob } from '../../lib/descarga';
import { diasDesde, fechaArchivo, formatearFecha } from '../../lib/fecha';
import { useEstadoSync } from '../../sync/servicio';
import { Aviso, Selector } from '../../ui/base';

export function Copias() {
  const { ajustes, datos, indice, hoy } = useEstado();
  const archivo = useRef<HTMLInputElement>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [pendiente, setPendiente] = useState<CopiaSeguridad | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [anioExcel, setAnioExcel] = useState(hoy.anio);
  const dias = diasDesde(ajustes.ultimaCopia);
  const sincronizado = useEstadoSync().fase !== 'desactivada';

  const anios = [...new Set([hoy.anio, ...datos.ingresos.map((i) => i.anio), ...datos.gastos.map((g) => g.anio)])].sort((a, b) => b - a);

  async function exportar() {
    const ahora = new Date();
    const copia = await exportarCopia(undefined, ahora);
    descargarBlob(new Blob([JSON.stringify(copia, null, 2)], { type: 'application/json' }), `finanzas-copia-${fechaArchivo(ahora)}.json`);
    await guardarAjustes({ ultimaCopia: ahora.toISOString() });
    setMensaje('Copia descargada. Guárdala fuera del móvil (iCloud Drive, Google Drive o el ordenador).');
  }

  async function elegirArchivo(f: File | undefined) {
    setErrores([]);
    setMensaje(null);
    setPendiente(null);
    if (!f) return;
    if (archivo.current) archivo.current.value = '';
    if (f.size > 20 * 1024 * 1024) {
      setErrores(['El archivo es demasiado grande para ser una copia de esta app.']);
      return;
    }
    const r = leerCopia(await f.text());
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setPendiente(r.copia);
  }

  async function confirmarImportacion() {
    if (!pendiente) return;
    try {
      await importarCopia(pendiente);
      setMensaje('Copia restaurada correctamente.');
    } catch (e) {
      setErrores([`No se pudo restaurar y no se ha cambiado nada: ${e instanceof Error ? e.message : String(e)}`]);
    }
    setPendiente(null);
  }

  async function exportarExcel() {
    const { generarExcel } = await import('../../lib/excel');
    const meses = serieMeses(indice, { anio: anioExcel, mes: 1 }, { anio: anioExcel, mes: 12 }, hoy);
    const prep = prepararRenta(datos, anioExcel, ajustes, true, hoy);
    const renta = prep.entrada.pagadores.length > 0 ? calcularIRPF(prep.entrada, ajustes.fiscal) : null;
    const blob = await generarExcel(hojasAnio(anioExcel, datos, meses, renta));
    descargarBlob(blob, `finanzas-${anioExcel}.xlsx`);
  }

  return (
    <section className="card" aria-labelledby="t-copias">
      <h2 id="t-copias">Copia de seguridad</h2>
      <p className="peq muted">
        {sincronizado
          ? 'Con la sincronización activa ya hay una copia cifrada en tu GitHub. Esta copia en archivo sirve además como respaldo independiente.'
          : 'Los datos solo están en este dispositivo. Si borras la app o cambias de móvil, sin copia se pierden.'}{' '}
        Última copia:{' '}
        <strong>{ajustes.ultimaCopia ? formatearFecha(ajustes.ultimaCopia) : 'nunca'}</strong>
        {dias !== null && dias > 30 && ` (hace ${dias} días)`}.
      </p>
      <div className="botones">
        <button type="button" className="btn primario" onClick={() => void exportar()}>Exportar copia (JSON)</button>
        <button type="button" className="btn" onClick={() => archivo.current?.click()}>Importar copia…</button>
      </div>
      <input
        ref={archivo}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Archivo de copia"
        onChange={(e) => void elegirArchivo(e.target.files?.[0])}
      />

      {errores.length > 0 && (
        <Aviso titulo="No se puede importar este archivo. Tus datos no se han tocado.">
          <ul className="peq" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Aviso>
      )}
      {pendiente && (
        <Aviso titulo="¿Sustituir TODOS los datos actuales?">
          <p className="peq">
            Copia del {formatearFecha(pendiente.exportadoEl)}: {pendiente.datos.ingresos.length} ingresos, {pendiente.datos.gastos.length} gastos,{' '}
            {pendiente.datos.extras.length} extras. Lo que tienes ahora se borrará. Si dudas, exporta antes una copia de lo actual.
          </p>
          <div className="botones">
            <button type="button" className="btn" onClick={() => setPendiente(null)}>Cancelar</button>
            <button type="button" className="btn peligro" onClick={() => void confirmarImportacion()}>Sí, sustituir</button>
          </div>
        </Aviso>
      )}
      {mensaje && <Aviso tipo="info">{mensaje}</Aviso>}

      <h3 style={{ marginTop: 16 }}>Exportar a Excel</h3>
      <div className="rejilla-2" style={{ alignItems: 'end' }}>
        <Selector etiqueta="Año" valor={String(anioExcel)} onCambio={(v) => setAnioExcel(Number(v))}>
          {anios.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Selector>
        <div className="campo">
          <button type="button" className="btn bloque" onClick={() => void exportarExcel()}>Descargar .xlsx</button>
        </div>
      </div>
    </section>
  );
}
