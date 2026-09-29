import { readFile } from 'fs/promises';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const W1_PATH = '/sys/bus/w1/devices';
const SENSOR_PREFIX = '28-';

// Rango plausible para un sensor de ambiente. Fuera de esto, la lectura se
// considera inválida (el DS18B20 devuelve 85000 = 85°C como valor por defecto
// tras un power-on reset o cuando se lee antes de terminar la conversión).
const MIN_VALID_TEMP = -10;
const MAX_VALID_TEMP = 80;
const POWER_ON_DEFAULT = 85; // °C, valor centinela del DS18B20

// Cache de la última lectura válida. Permite que los consumidores (ej. el
// endpoint HTTP) obtengan un valor sin volver a bloquear sobre el hardware.
let lastValidTemperature: number | null = null;
let lastValidTimestamp = 0;

// Cache de la ruta del sensor para no re-escanear el bus 1-Wire en cada lectura.
let cachedSensorPath: string | null = null;

/**
 * Obtiene la ruta del sensor de temperatura DS18B20
 * @returns la ruta al archivo del sensor
 * @throws Error si no se encuentra el bus 1-Wire o el sensor
 */
function getSensorPath(): string {
  if (cachedSensorPath && existsSync(cachedSensorPath)) {
    return cachedSensorPath;
  }

  if (!existsSync(W1_PATH)) {
    throw new Error('1-Wire no disponible (¿está habilitado en /boot/config.txt?)');
  }

  const devices = readdirSync(W1_PATH);
  const sensorFolder = devices.find((name) => name.startsWith(SENSOR_PREFIX));

  if (!sensorFolder) {
    throw new Error('Sensor DS18B20 no encontrado en el bus 1-Wire');
  }

  cachedSensorPath = join(W1_PATH, sensorFolder, 'w1_slave');
  return cachedSensorPath;
}

/**
 * Lee la temperatura actual del sensor DS18B20 de forma asíncrona.
 *
 * Valida el CRC reportado por el kernel (línea que termina en "YES") y descarta
 * el valor centinela de 85°C y lecturas fuera de rango plausible. Si la lectura
 * es inválida pero hay un valor previo reciente, lo reutiliza; de lo contrario
 * lanza un error para que la lógica de control lo maneje.
 *
 * @returns la temperatura actual en grados Celsius
 * @throws Error si no puede obtener una lectura válida
 */
export async function getTemperature(): Promise<number> {
  const sensorPath = getSensorPath();
  const data = await readFile(sensorPath, 'utf-8');

  // El driver w1_therm escribe dos líneas:
  //   <bytes> : crc=XX YES|NO
  //   <bytes> t=NNNNN
  const lines = data.trim().split('\n');
  if (lines.length < 2 || !lines[0].trim().endsWith('YES')) {
    throw new Error('Lectura del sensor con CRC inválido (NO)');
  }

  const match = lines[1].match(/t=(-?\d+)/);
  if (!match) {
    throw new Error('Formato de datos del sensor inválido');
  }

  const tempC = parseInt(match[1], 10) / 1000;

  // Rechazar el valor centinela de power-on (85.000°C exacto) y lecturas
  // claramente fuera de rango.
  if (tempC === POWER_ON_DEFAULT || tempC < MIN_VALID_TEMP || tempC > MAX_VALID_TEMP) {
    throw new Error(`Lectura de temperatura inválida o fuera de rango: ${tempC}°C`);
  }

  lastValidTemperature = tempC;
  lastValidTimestamp = Date.now();
  return tempC;
}

/**
 * Devuelve la última temperatura válida cacheada sin tocar el hardware.
 * @returns la última temperatura válida, o null si nunca se obtuvo una
 */
export function getLastTemperature(): number | null {
  return lastValidTemperature;
}

/**
 * Devuelve el timestamp (ms epoch) de la última lectura válida.
 */
export function getLastTemperatureTimestamp(): number {
  return lastValidTimestamp;
}
