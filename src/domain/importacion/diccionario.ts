import type { ClaveCategoria, TipoGasto } from '../modelo';

/**
 * Diccionario de comercios habituales en España e Ibiza. Cada patrón se busca como inicio de palabra
 * en el concepto ya limpio y en minúsculas sin tildes. El orden importa: lo más específico primero.
 * Ampliable: las reglas que aprende la app de tus correcciones tienen prioridad sobre esta lista.
 */
export interface EntradaDiccionario {
  patrones: readonly string[];
  categoria: ClaveCategoria;
  tipo?: TipoGasto;
}

export const DICCIONARIO: readonly EntradaDiccionario[] = [
  // Impuestos y administraciones (antes que "renta" o "seguro" genéricos)
  { patrones: ['aeat', 'agencia tributaria', 'agencia estatal admin', 'atib', 'agencia tributaria illes', 'ajuntament', 'ayuntamiento', 'consell insular', 'dgt ', 'jefatura de trafico', 'tasa ', 'impuesto', 'seguridad social', 'tgss', 'ibi '], categoria: 'impuestos' },

  // Suministros (Baleares: GESA/Endesa)
  { patrones: ['endesa', 'gesa', 'iberdrola', 'naturgy', 'gas natural', 'repsol luz', 'totalenergies', 'holaluz', 'octopus', 'lucera', 'aqualia', 'aguas de', 'agua de', 'agbar', 'canal de isabel', 'butano', 'emaya'], categoria: 'suministros', tipo: 'Fijo' },

  // Móvil e internet
  { patrones: ['movistar', 'telefonica', 'vodafone', 'orange', 'yoigo', 'masmovil', 'mas movil', 'digi ', 'digimobil', 'simyo', 'pepephone', 'lowi', 'jazztel', 'o2 ', 'finetwork', 'avatel', 'adamo'], categoria: 'movil', tipo: 'Fijo' },

  // Suscripciones digitales
  { patrones: ['netflix', 'spotify', 'hbo', 'max.com', 'disney', 'prime video', 'amazon prime', 'primevideo', 'apple.com/bill', 'apple com bill', 'itunes', 'icloud', 'google one', 'google storage', 'youtube premium', 'youtubepremium', 'dazn', 'movistar plus', 'filmin', 'skyshowtime', 'playstation network', 'xbox', 'nintendo', 'chatgpt', 'openai', 'anthropic', 'claude.ai', 'adobe', 'microsoft 365', 'office 365', 'dropbox', 'audible', 'kindle unlimited', 'patreon', 'twitch', 'tinder', 'bumble', 'duolingo', 'canva', 'notion'], categoria: 'suscripciones', tipo: 'Fijo' },

  // Seguros
  { patrones: ['mapfre', 'axa ', 'allianz', 'linea directa', 'mutua madrilena', 'mutua', 'generali', 'zurich', 'reale', 'catalana occidente', 'ocaso', 'santalucia', 'verti', 'genesis', 'pelayo', 'seguro', 'seguros'], categoria: 'seguros', tipo: 'Fijo' },

  // Deudas y financiación
  { patrones: ['prestamo', 'cofidis', 'cetelem', 'klarna', 'aplazame', 'sequra', 'oney', 'financiacion', 'amortizacion', 'cuota credito', 'wizink', 'carrefour pass'], categoria: 'deudas', tipo: 'Fijo' },

  // Supermercados y alimentación
  { patrones: ['mercadona', 'carrefour', 'lidl', 'aldi', 'supermercados dia', 'dia retail', 'eroski', 'consum', 'spar', 'hiper centro', 'hipercentro', 'alcampo', 'hipercor', 'caprabo', 'bonpreu', 'condis', 'covirán', 'coviran', 'supercor', 'el corte ingles super', 'ahorramas', 'froiz', 'gadis', 'masymas', 'super ', 'supermercado', 'supermarket', 'fruteria', 'carniceria', 'panaderia', 'pescaderia', 'mercado', 'charcuteria', 'colmado', 'alimentacion', 'ultramarinos', 'forn', 'supermercat', 'carnisseria', 'peixateria', 'fruiteria', 'queviures'], categoria: 'comida' },

  // Comida a domicilio, restaurantes y bares
  { patrones: ['glovo', 'just eat', 'justeat', 'uber eats', 'ubereats', 'deliveroo', 'telepizza', 'domino', 'burger king', 'mcdonald', 'kfc', 'taco bell', 'five guys', 'goiko', 'foster', 'vips', 'tgi', 'starbucks', 'costa coffee', 'tim hortons', 'restaurante', 'restaurant', 'rest ', 'bar ', 'cafe', 'cafeteria', 'cerveceria', 'taberna', 'tasca', 'meson', 'pizzeria', 'trattoria', 'sushi', 'kebab', 'bocateria', 'heladeria', 'pasteleria', 'chiringuito', 'beach club', 'brasa', 'asador', 'grill', 'wok', 'ramen', 'tapas', 'bodega'], categoria: 'restaurantes' },

  // Transporte (Ibiza incluido)
  { patrones: ['repsol', 'cepsa', 'moeve', 'galp', 'bp ', 'shell', 'petronor', 'disa', 'ballenoil', 'plenoil', 'gasolinera', 'estacion de servicio', 'e.s. ', 'renfe', 'alsa', 'avanza', 'ibiza bus', 'eivissa bus', 'sagales', 'tib ', 'emt ', 'metro', 'taxi', 'uber', 'cabify', 'bolt', 'freenow', 'free now', 'blablacar', 'parking', 'aparcamiento', 'telpark', 'empark', 'saba ', 'autopista', 'peaje', 'itv', 'taller', 'neumaticos', 'norauto', 'midas', 'feu vert', 'goldcar', 'record go', 'cicar', 'sixt', 'europcar', 'hertz', 'avis', 'moto rent', 'rent a car'], categoria: 'transporte' },

  // Viajes
  { patrones: ['vueling', 'ryanair', 'iberia', 'air europa', 'easyjet', 'binter', 'volotea', 'wizz', 'jet2', 'aena', 'trasmed', 'balearia', 'baleària', 'fred olsen', 'mediterranea pitiusa', 'aquabus', 'booking', 'airbnb', 'expedia', 'edreams', 'hotel', 'hostal', 'apartamentos', 'hostel', 'trivago', 'skyscanner', 'logitravel'], categoria: 'viajes' },

  // Salud
  { patrones: ['farmacia', 'parafarmacia', 'clinica', 'dentista', 'dental', 'hospital', 'policlinica', 'sanitas', 'adeslas', 'asisa', 'dkv', 'quironsalud', 'optica', 'opticalia', 'multiopticas', 'general optica', 'fisioterapia', 'fisio', 'psicolog', 'medico', 'laboratorio', 'podolog'], categoria: 'salud' },

  // Ropa y cuidado personal
  { patrones: ['zara', 'bershka', 'pull&bear', 'pull and bear', 'pull bear', 'stradivarius', 'massimo dutti', 'oysho', 'lefties', 'h&m', 'hm ', 'primark', 'mango', 'kiabi', 'c&a', 'decathlon', 'nike', 'adidas', 'jd sports', 'foot locker', 'sprinter', 'springfield', 'cortefiel', 'desigual', 'shein', 'zalando', 'vinted', 'el corte ingles', 'peluqueria', 'barberia', 'barber', 'estetica', 'sephora', 'druni', 'primor', 'douglas', 'rituals', 'kiko'], categoria: 'ropa' },

  // Hogar
  { patrones: ['ikea', 'leroy merlin', 'bricomart', 'bricodepot', 'brico', 'ferreteria', 'conforama', 'jysk', 'maisons du monde', 'zara home', 'casa ', 'mediamarkt', 'media markt', 'worten', 'fnac', 'pccomponentes', 'apple store', 'lavanderia', 'tintoreria', 'limpieza'], categoria: 'hogar' },

  // Ocio (Ibiza: discotecas)
  { patrones: ['cine', 'cines', 'yelmo', 'kinepolis', 'ocine', 'teatro', 'ticketmaster', 'entradas', 'eventbrite', 'fever', 'steam', 'epic games', 'playstation store', 'gimnasio', 'gym', 'basic fit', 'basic-fit', 'mcfit', 'anytime fitness', 'altafit', 'pacha', 'amnesia', 'ushuaia', 'hi ibiza', 'dc10', 'dc-10', 'privilege', 'eden ', 'es paradis', 'ocean beach', 'o beach', 'club', 'discoteca', 'pub ', 'loteria', 'apuestas', 'bet365', 'codere', 'libreria', 'casa del libro', 'amazon kindle', 'concierto', 'museo', 'padel', 'golf'], categoria: 'ocio' },

  // Educación
  { patrones: ['academia', 'universidad', 'uned', 'escuela', 'colegio', 'udemy', 'coursera', 'domestika', 'autoescuela', 'curso', 'formacion', 'matricula'], categoria: 'educacion' },

  // Mascotas
  { patrones: ['veterinari', 'kiwoko', 'tiendanimal', 'zooplus', 'mascota', 'pet '], categoria: 'mascotas' },

  // Regalos
  { patrones: ['floristeria', 'regalo', 'juguet', 'toys'], categoria: 'regalos' },

  // Tiendas online genéricas: van a revisión (pueden ser cualquier cosa), con "Otros" como propuesta
  { patrones: ['amazon', 'amzn', 'aliexpress', 'temu', 'ebay', 'paypal', 'wallapop'], categoria: 'otros' },
];

/** Comercios genéricos: aunque estén en el diccionario, se mandan a revisión. */
export const AMBIGUOS: readonly string[] = ['amazon', 'amzn', 'aliexpress', 'temu', 'ebay', 'paypal', 'wallapop', 'el corte ingles', 'club', 'casa ', 'super '];

export function buscarEnDiccionario(texto: string): EntradaDiccionario | null {
  const t = ` ${texto} `;
  for (const e of DICCIONARIO) {
    for (const p of e.patrones) {
      if (t.includes(` ${p}`)) return e;
    }
  }
  return null;
}

export function esAmbiguo(texto: string): boolean {
  const t = ` ${texto} `;
  return AMBIGUOS.some((p) => t.includes(` ${p}`));
}
