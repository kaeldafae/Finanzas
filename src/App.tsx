import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Periodo } from './domain/modelo';
import { useEstado } from './estado';
import { solicitarPersistencia, type EstadoAlmacenamiento } from './lib/almacenamiento';
import { diasDesde } from './lib/fecha';
import { PantallaMes } from './screens/PantallaMes';
import { iniciarSync, useEstadoSync } from './sync/servicio';
import { IconoAjustes, IconoAnio, IconoColchon, IconoMes, IconoRenta } from './ui/iconos';

// La pantalla Mes va en el paquete inicial; el resto se carga al abrirla (y queda en caché para offline).
const PantallaAjustes = lazy(() =>
  import('./screens/PantallaAjustes').then((m) => ({
    default: m.PantallaAjustes,
  })),
);
const PantallaAnio = lazy(() => import('./screens/PantallaAnio').then((m) => ({ default: m.PantallaAnio })));
const PantallaColchon = lazy(() =>
  import('./screens/PantallaColchon').then((m) => ({
    default: m.PantallaColchon,
  })),
);
const PantallaRenta = lazy(() => import('./screens/PantallaRenta').then((m) => ({ default: m.PantallaRenta })));
const PantallaImportar = lazy(() => import('./screens/PantallaImportar').then((m) => ({ default: m.PantallaImportar })));

const RUTAS = ['mes', 'anio', 'colchon', 'renta', 'ajustes', 'importar'] as const;
type Ruta = (typeof RUTAS)[number];

const PESTANAS: ReadonlyArray<{ ruta: Ruta; texto: string; icono: ReactNode }> = [
  { ruta: 'mes', texto: 'Mes', icono: <IconoMes /> },
  { ruta: 'anio', texto: 'Año', icono: <IconoAnio /> },
  { ruta: 'colchon', texto: 'Colchón', icono: <IconoColchon /> },
  { ruta: 'renta', texto: 'Renta', icono: <IconoRenta /> },
  { ruta: 'ajustes', texto: 'Ajustes', icono: <IconoAjustes /> },
];

function rutaActual(): Ruta {
  const r = window.location.hash.replace(/^#\/?/, '');
  return (RUTAS as readonly string[]).includes(r) ? (r as Ruta) : 'mes';
}

/** Navegación por hash: GitHub Pages no reescribe rutas, así que una recarga nunca da 404. */
function useRuta(): [Ruta, (r: Ruta) => void] {
  const [ruta, setRuta] = useState<Ruta>(rutaActual);
  useEffect(() => {
    const alCambiar = () => {
      setRuta(rutaActual());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);
  return [
    ruta,
    (r) => {
      window.location.hash = `/${r}`;
    },
  ];
}

function useTema() {
  const { ajustes } = useEstado();
  useEffect(() => {
    const raiz = document.documentElement;
    if (ajustes.tema === 'auto') raiz.removeAttribute('data-theme');
    else raiz.setAttribute('data-theme', ajustes.tema);
  }, [ajustes.tema]);
}

function AvisoActualizacion() {
  const {
    needRefresh: [hayVersion, setHayVersion],
    offlineReady: [listaOffline, setListaOffline],
    updateServiceWorker,
  } = useRegisterSW();

  if (hayVersion) {
    return (
      <div className="toast" role="status">
        <span>Hay una versión nueva.</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => setHayVersion(false)}>
            Luego
          </button>
          <button type="button" className="btn primario" onClick={() => void updateServiceWorker(true)}>
            Actualizar
          </button>
        </span>
      </div>
    );
  }
  if (listaOffline) {
    return (
      <div className="toast" role="status">
        <span>Lista para usar sin conexión.</span>
        <button type="button" className="btn" onClick={() => setListaOffline(false)}>
          Vale
        </button>
      </div>
    );
  }
  return null;
}

export function App() {
  const { hoy, ajustes } = useEstado();
  const [ruta, irA] = useRuta();
  const [periodo, setPeriodo] = useState<Periodo>(hoy);
  const [almacenamiento, setAlmacenamiento] = useState<EstadoAlmacenamiento | null>(null);
  useTema();

  const sync = useEstadoSync();

  useEffect(() => {
    void solicitarPersistencia().then(setAlmacenamiento);
    iniciarSync();
  }, []);

  const dias = diasDesde(ajustes.ultimaCopia);
  // Con la sincronización funcionando, los datos ya tienen una copia cifrada fuera del dispositivo.
  const syncActiva = sync.fase === 'al-dia' || sync.fase === 'sincronizando';
  const recordarCopia = (dias === null || dias > 30) && ruta !== 'ajustes' && ruta !== 'importar' && !syncActiva;
  const avisoSync = sync.fase === 'error' && sync.accion !== null && ruta !== 'ajustes';

  return (
    <>
      <main className="app" id="contenido">
        {avisoSync && (
          <div className="aviso" role="alert">
            <strong>La sincronización está parada</strong>
            {sync.error}
            <div>
              <button type="button" className="btn" onClick={() => irA('ajustes')}>
                Arreglarlo
              </button>
            </div>
          </div>
        )}
        {recordarCopia && (
          <div className="aviso" role="status">
            <strong>{dias === null ? 'Aún no has hecho ninguna copia de seguridad' : `Última copia hace ${dias} días`}</strong>
            Tus datos solo están en este dispositivo.
            <div>
              <button type="button" className="btn" onClick={() => irA('ajustes')}>
                Hacer copia
              </button>
            </div>
          </div>
        )}
        <Suspense fallback={<p role="status">Cargando…</p>}>
          {ruta === 'mes' && <PantallaMes periodo={periodo} onCambio={setPeriodo} />}
          {ruta === 'anio' && (
            <PantallaAnio
              anio={periodo.anio}
              onCambioAnio={(anio) => setPeriodo({ ...periodo, anio })}
              onAbrirMes={(p) => {
                setPeriodo(p);
                irA('mes');
              }}
            />
          )}
          {ruta === 'colchon' && <PantallaColchon />}
          {ruta === 'renta' && <PantallaRenta anio={periodo.anio} onCambioAnio={(anio) => setPeriodo({ ...periodo, anio })} />}
          {ruta === 'ajustes' && <PantallaAjustes almacenamiento={almacenamiento} />}
          {ruta === 'importar' && <PantallaImportar onTerminar={() => irA('anio')} />}
        </Suspense>
      </main>
      <nav className="nav" aria-label="Secciones">
        {PESTANAS.map((p) => (
          <a key={p.ruta} href={`#/${p.ruta}`} aria-current={ruta === p.ruta || (ruta === 'importar' && p.ruta === 'ajustes') ? 'page' : undefined}>
            {p.icono}
            {p.texto}
          </a>
        ))}
      </nav>
      <AvisoActualizacion />
    </>
  );
}
