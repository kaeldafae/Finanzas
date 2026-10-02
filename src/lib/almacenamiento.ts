export interface EstadoAlmacenamiento {
  /** null si el navegador no permite consultarlo. */
  persistente: boolean | null;
  usoBytes: number | null;
  instalada: boolean;
}

function esInstalada(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

/** Pide al navegador que no borre los datos ante falta de espacio. */
export async function solicitarPersistencia(): Promise<EstadoAlmacenamiento> {
  const instalada = esInstalada();
  const storage = 'storage' in navigator ? navigator.storage : undefined;
  if (!storage?.persisted) return { persistente: null, usoBytes: null, instalada };
  try {
    let persistente = await storage.persisted();
    if (!persistente && typeof storage.persist === 'function') persistente = await storage.persist();
    const estimacion = typeof storage.estimate === 'function' ? await storage.estimate() : undefined;
    return { persistente, usoBytes: estimacion?.usage ?? null, instalada };
  } catch {
    return { persistente: null, usoBytes: null, instalada };
  }
}
