import { useEffect, useMemo, useState } from 'react';
import { interpretar, interpretarConIA, responder, type Consulta, type Respuesta } from '../domain/asistente';
import { nombreMes, type Periodo } from '../domain/modelo';
import { useEstado } from '../estado';
import { Aviso, Importe } from '../ui/base';

const EJEMPLOS = [
  '¿Cuánto gasté en restaurantes este año?',
  '¿En qué gasto más el mes pasado?',
  'Compara comida de marzo frente a abril',
  '¿Cuánto ahorré en los últimos 6 meses?',
  'Mis pagos recurrentes',
  '¿Cómo van mis objetivos?',
];

const TIPOS: Record<Consulta['tipo'], string> = {
  gasto: 'gasto', ingreso: 'ingresos', resultado: 'resultado', comparar: 'comparación', categorias: 'gasto por categorías',
  recurrentes: 'pagos recurrentes', objetivos: 'objetivos', movimientos: 'movimientos',
};

const mes = (p: Periodo) => `${nombreMes(p.mes).toLowerCase()} ${p.anio}`;

/** Preguntas sobre tus datos. Las cifras las calcula el motor; la IA, si se usa, solo entiende la pregunta. */
export function PantallaPreguntar() {
  const { datos, hoy } = useEstado();
  const [pregunta, setPregunta] = useState('');
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [noEntendida, setNoEntendida] = useState(false);
  const [iaDisponible, setIaDisponible] = useState(false);
  const [pensando, setPensando] = useState(false);
  const comercios = useMemo(() => [...new Set(datos.gastos.flatMap((g) => (g.comercio ? [g.comercio] : [])))], [datos.gastos]);

  useEffect(() => {
    let vivo = true;
    void import('../ia/motorLocal')
      .then(async (m) => (await m.comprobarSoporte()).ok && (await m.modeloDescargado(m.modeloElegido().id)))
      .catch(() => false)
      .then((ok) => vivo && setIaDisponible(ok));
    return () => {
      vivo = false;
    };
  }, []);

  function preguntar(texto: string) {
    setPregunta(texto);
    const c = interpretar(texto, hoy, datos.categorias, comercios);
    setConsulta(c);
    setNoEntendida(c === null);
  }

  async function conIA() {
    setPensando(true);
    try {
      const m = await import('../ia/motorLocal');
      const motor = await m.cargarMotor(m.modeloElegido().id);
      const c = await interpretarConIA(motor, pregunta, hoy, datos.categorias);
      setConsulta(c);
      setNoEntendida(c === null);
    } catch {
      setNoEntendida(true);
    } finally {
      setPensando(false);
    }
  }

  const r: Respuesta | null = consulta ? responder(consulta, datos, hoy) : null;
  const nombreCat = (id: string) => datos.categorias.find((c) => c.id === id)?.nombre ?? '';

  return (
    <>
      <h1>Preguntar</h1>
      <section className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            preguntar(pregunta);
          }}
        >
          <div className="campo">
            <label htmlFor="pregunta">Tu pregunta</label>
            <input id="pregunta" type="text" value={pregunta} onChange={(e) => setPregunta(e.target.value)} placeholder="¿Cuánto gasté en bares este año?" autoComplete="off" maxLength={300} />
          </div>
          <button type="submit" className="btn primario bloque" disabled={!pregunta.trim()}>Preguntar</button>
        </form>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {EJEMPLOS.map((e) => (
            <button key={e} type="button" className="btn compacto" onClick={() => preguntar(e)}>{e}</button>
          ))}
        </div>
        <p className="peq muted" style={{ marginTop: 8 }}>Todo se calcula en este dispositivo con tus datos. Nada sale de aquí.</p>
      </section>

      {noEntendida && (
        <Aviso tipo="info" titulo="No he entendido la pregunta">
          Prueba con uno de los ejemplos o di el periodo y la categoría («¿cuánto gasté en comida en marzo?»).
          {iaDisponible && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn" disabled={pensando} onClick={() => void conIA()}>
                {pensando ? 'Pensando…' : 'Interpretar con la IA integrada'}
              </button>
            </div>
          )}
        </Aviso>
      )}

      {r && consulta && (
        <section className="card" aria-labelledby="t-resp" aria-live="polite">
          <h2 id="t-resp">{r.titulo}</h2>
          <p>{r.texto}</p>
          {r.cifras.length > 0 && (
            <ul className="lista">
              {r.cifras.map((c) => (
                <li key={c.etiqueta} className="fila"><span className="principal">{c.etiqueta}</span><Importe c={c.importe} /></li>
              ))}
            </ul>
          )}
          {r.movimientos.length > 0 && (
            <details className="peq">
              <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Movimientos ({r.movimientos.length})</summary>
              <ul className="lista">
                {r.movimientos.map((m, i) => (
                  <li key={i} className="fila"><span className="principal">{m.concepto}<span className="secundario" style={{ display: 'block' }}>{m.fecha}</span></span><Importe c={m.importe} signo /></li>
                ))}
              </ul>
            </details>
          )}
          <p className="peq muted" style={{ marginTop: 8 }}>
            <strong>Entendido como:</strong> {TIPOS[consulta.tipo]}
            {consulta.categoriaId && ` · ${nombreCat(consulta.categoriaId)}`}
            {consulta.comercio && ` · ${consulta.comercio}`} · {mes(consulta.desde)}
            {(consulta.hasta.anio !== consulta.desde.anio || consulta.hasta.mes !== consulta.desde.mes) && ` – ${mes(consulta.hasta)}`}
            {consulta.desde2 && consulta.hasta2 && ` frente a ${mes(consulta.desde2)}`}
            <br />
            <strong>De dónde sale:</strong> {r.evidencia}
          </p>
        </section>
      )}
    </>
  );
}
