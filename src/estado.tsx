import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, use, useMemo, type ReactNode } from 'react';
import type { Ajustes, Periodo } from './domain/modelo';
import { indexar, type DatosFinancieros, type IndiceMeses } from './domain/resumen';
import { leerAjustes, leerTodo } from './db/operaciones';
import { hoyPeriodo } from './lib/fecha';

export interface Estado {
  datos: DatosFinancieros;
  indice: IndiceMeses;
  ajustes: Ajustes;
  hoy: Periodo;
}

const Contexto = createContext<Estado | null>(null);

export function ProveedorDatos({ children, cargando }: { children: ReactNode; cargando: ReactNode }) {
  const datos = useLiveQuery(() => leerTodo(), []);
  const ajustes = useLiveQuery(() => leerAjustes(), []);
  const valor = useMemo<Estado | null>(() => {
    if (!datos || !ajustes) return null;
    return { datos, ajustes, indice: indexar(datos), hoy: hoyPeriodo() };
  }, [datos, ajustes]);
  if (!valor) return <>{cargando}</>;
  return <Contexto value={valor}>{children}</Contexto>;
}

export function useEstado(): Estado {
  const v = use(Contexto);
  if (!v) throw new Error('useEstado fuera de ProveedorDatos');
  return v;
}
