/**
 * Persistencia mínima del estado del termostato en disco.
 *
 * El estado vive en memoria (sin base de datos), pero el setpoint debe sobrevivir
 * a reinicios del proceso y, sobre todo, a cortes de luz de la Raspberry. Se
 * guarda un JSON chico y se escribe SOLO cuando el usuario cambia el setpoint
 * (evento poco frecuente), así no hay desgaste relevante de la SD.
 *
 * La escritura es atómica (archivo temporal + rename) para no dejar un JSON
 * corrupto si se corta la luz justo durante el guardado.
 */
import { writeFile, rename, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

// Ubicación basada en __dirname para ser estable sin importar el cwd de PM2:
//   dist/services/persistence.js -> dist/services -> dist -> backend/data/state.json
const STATE_FILE =
  process.env.THERMOSTAT_STATE_FILE || join(__dirname, '..', '..', 'data', 'thermostat-state.json');

export interface PersistedState {
  targetTemperature?: number;
  isRunning?: boolean; // modo on/off del termostato (para respetarlo tras reinicio/corte de luz)
}

/**
 * Lee el estado persistido de forma síncrona (se llama una sola vez al arrancar,
 * antes de iniciar el termostato). Devuelve {} si el archivo no existe o está
 * corrupto: en ese caso se usan los valores por defecto.
 */
export function loadPersistedState(): PersistedState {
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as PersistedState;
    }
    return {};
  } catch {
    // Archivo inexistente (primer arranque) o ilegible: arrancar con defaults.
    return {};
  }
}

/**
 * Guarda el estado de forma atómica. Errores de E/S se logean pero no propagan:
 * no persistir nunca debe tumbar el control de la caldera.
 */
export async function savePersistedState(state: PersistedState): Promise<void> {
  try {
    await mkdir(dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(state), 'utf-8');
    await rename(tmp, STATE_FILE);
  } catch (error) {
    console.warn(`[PERSIST] No se pudo guardar el estado en ${STATE_FILE}:`, error);
  }
}
