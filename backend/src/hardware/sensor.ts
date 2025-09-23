import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const W1_PATH = '/sys/bus/w1/devices';
const SENSOR_PREFIX = '28-';

/**
 * Obtiene la ruta del sensor de temperatura DS18B20
 * @returns la ruta al archivo del sensor o null si no se encuentra
 */
function getSensorPath(): string | null {
  try {
    if (!existsSync(W1_PATH)) {
      console.error('Error: Directorio de sensores 1-Wire no encontrado');
      throw new Error('1-Wire no disponible');
    }
    
    const devices = readdirSync(W1_PATH);
    const sensorFolder = devices.find((name) => name.startsWith(SENSOR_PREFIX));
    
    if (!sensorFolder) {
      console.error('Error: No se encontró ningún sensor DS18B20');
      throw new Error('Sensor DS18B20 no encontrado');
    }
    
    return join(W1_PATH, sensorFolder, 'w1_slave');
  } catch (error) {
    console.error('Error al obtener la ruta del sensor:', error);
    throw error;
  }
}

/**
 * Lee la temperatura actual del sensor DS18B20
 * @returns la temperatura actual en grados Celsius
 * @throws Error si no puede leer la temperatura
 */
export function getTemperature(): number {
  try {
    const sensorPath = getSensorPath();
    if (!sensorPath) {
      throw new Error("Sensor path is null");
    }
    const data = readFileSync(sensorPath, 'utf-8');
    const match = data.match(/t=(\d+)/);
    
    if (match) {
      const tempC = parseInt(match[1], 10) / 1000;
      return tempC;
    } else {
      console.error('Error: No se pudo interpretar la lectura del sensor');
      throw new Error('Formato de datos del sensor inválido');
    }
  } catch (error) {
    console.error('Error leyendo el sensor:', error);
    throw error;
  }
}
