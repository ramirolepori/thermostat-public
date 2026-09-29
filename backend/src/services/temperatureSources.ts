/**
 * Gestión de fuentes externas de temperatura (ej. HomePods).
 *
 * Cada fuente reporta su temperatura vía HTTP (POST /api/external-temperature)
 * identificándose con un `id`. El backend combina estas lecturas con la del
 * sensor local DS18B20 promediando todas las que estén "frescas".
 *
 * Si una fuente deja de reportar (HomePod offline) su lectura caduca y se
 * excluye del promedio automáticamente, sin intervención.
 */

// Ventana de frescura: una fuente que no reporta hace más de esto se ignora.
const FRESHNESS_MS = 15 * 60 * 1000; // 15 minutos

// Rango plausible para una temperatura de ambiente reportada por un HomePod.
const MIN_VALID_TEMP = 0;
const MAX_VALID_TEMP = 50;

// Límites para que un cliente no pueda hacer crecer el mapa sin control.
const MAX_ID_LENGTH = 64;
const MAX_SOURCES = 20;

interface ExternalSource {
  id: string;
  value: number;        // °C
  updatedAt: number;    // epoch ms
}

const sources = new Map<string, ExternalSource>();

/**
 * Registra (o actualiza) la lectura de una fuente externa.
 * @throws Error si el valor está fuera de rango plausible
 */
export function recordExternalTemperature(id: string, value: number): ExternalSource {
  if (typeof value !== 'number' || isNaN(value) || value < MIN_VALID_TEMP || value > MAX_VALID_TEMP) {
    throw new Error(`Temperatura externa inválida o fuera de rango: ${value}°C`);
  }
  if (id.length > MAX_ID_LENGTH) {
    throw new Error(`El id de la fuente supera ${MAX_ID_LENGTH} caracteres`);
  }
  if (!sources.has(id) && sources.size >= MAX_SOURCES) {
    throw new Error(`Se alcanzó el máximo de ${MAX_SOURCES} fuentes externas`);
  }
  const entry: ExternalSource = { id, value, updatedAt: Date.now() };
  sources.set(id, entry);
  return entry;
}

/**
 * Devuelve las fuentes externas que reportaron dentro de la ventana de frescura.
 */
export function getFreshExternalSources(): ExternalSource[] {
  const now = Date.now();
  return Array.from(sources.values()).filter((s) => now - s.updatedAt < FRESHNESS_MS);
}

/**
 * Devuelve un snapshot de todas las fuentes (frescas y caducadas) con su antigüedad,
 * útil para diagnóstico/estado.
 */
export function getAllExternalSources(): Array<ExternalSource & { ageMs: number; fresh: boolean }> {
  const now = Date.now();
  return Array.from(sources.values()).map((s) => ({
    ...s,
    ageMs: now - s.updatedAt,
    fresh: now - s.updatedAt < FRESHNESS_MS,
  }));
}
