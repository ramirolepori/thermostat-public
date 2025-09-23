import { getTemperature } from "../hardware/sensor";
import { turnOnRelay, turnOffRelay, getRelayState, toggleRelay } from "../hardware/relay";
import { SettingModel } from "../database/settings.model"; // Importar el modelo de configuración
import { publishSetpointUpdate, publishModeUpdate } from "./mqtt"; // Importar función MQTT para publicar actualizaciones

// Configuración del termostato
interface ThermostatConfig {
  targetTemperature: number; // Temperatura objetivo deseada
  hysteresis: number; // Diferencial para evitar ciclos frecuentes
  checkIntervalMs: number; // Intervalo para revisar la temperatura
  maxConsecutiveErrors: number; // Máximo de errores consecutivos permitidos
}

// Estado del termostato
interface ThermostatState {
  currentTemperature: number; // Temperatura actual
  targetTemperature: number; // Temperatura objetivo
  hysteresis: number; // Histéresis configurada
  isHeating: boolean; // Estado de la calefacción
  lastUpdated: Date; // Última actualización del estado
  isRunning: boolean; // Si el termostato está activo o no
  lastError: string | null; // Último error ocurrido
  consecutiveErrors: number; // Contador de errores consecutivos
}

// Valores predeterminados
const DEFAULT_CONFIG: ThermostatConfig = {
  targetTemperature: 22, // 22°C por defecto
  hysteresis: 1.5, // Diferencial de 1.5°C
  checkIntervalMs: 3000, // Revisar cada 3 segundos (mejora de performance)
  maxConsecutiveErrors: 5, // Máximo de errores consecutivos antes de apagar el sistema
};

// Estado inicial
let thermostatState: ThermostatState = {
  currentTemperature: 0,
  targetTemperature: DEFAULT_CONFIG.targetTemperature,
  hysteresis: DEFAULT_CONFIG.hysteresis,
  isHeating: false,
  lastUpdated: new Date(),
  isRunning: false,
  lastError: null,
  consecutiveErrors: 0,
};

let thermostatConfig: ThermostatConfig = { ...DEFAULT_CONFIG };
let thermostatInterval: NodeJS.Timeout | null = null;
let lastControlAction = Date.now(); // Rastrear la última vez que se tomó una acción de control

// Evento que se dispara cuando se detecta un error crítico
type ErrorHandler = (error: string) => void;
const errorHandlers: ErrorHandler[] = [];

/**
 * Registra un manejador para eventos de error crítico
 */
export function onCriticalError(handler: ErrorHandler): void {
  errorHandlers.push(handler);
}

/**
 * Inicia el termostato con la configuración proporcionada
 */
export function startThermostat(config: Partial<ThermostatConfig> = {}): boolean {
  try {
    // Actualizar configuración con los valores proporcionados
    thermostatConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    // Solo iniciar si no está ya corriendo
    if (!thermostatState.isRunning) {
      console.log(
        `Iniciando termostato con temperatura objetivo: ${thermostatConfig.targetTemperature}°C`
      );
      console.log(`Histéresis configurada a: ${thermostatConfig.hysteresis}°C`);

      // Inicializar el estado
      thermostatState.lastError = null;
      thermostatState.consecutiveErrors = 0;
      const initialUpdateSuccess = updateCurrentState();
      
      if (!initialUpdateSuccess) {
        console.warn("Advertencia: No se pudo leer la temperatura inicial, iniciando con valores predeterminados");
      }

      // Iniciar el intervalo para revisar la temperatura periódicamente
      thermostatInterval = setInterval(() => {
        const stateUpdateSuccess = updateCurrentState();
        if (stateUpdateSuccess) {
          resetErrorCounter(); // Resetear contador de errores tras éxito
          controlHeating();
        } else {
          thermostatState.consecutiveErrors++;
          console.error(`Error consecutivo #${thermostatState.consecutiveErrors} al actualizar estado`);
          
          // Si hay demasiados errores consecutivos, apagar el sistema por seguridad
          if (thermostatState.consecutiveErrors >= thermostatConfig.maxConsecutiveErrors) {
            const errorMsg = `Demasiados errores consecutivos (${thermostatState.consecutiveErrors}), apagando termostato por seguridad`;
            console.error(errorMsg);
            notifyCriticalError(errorMsg);
            stopThermostat();
          }
        }
      }, thermostatConfig.checkIntervalMs);

      thermostatState.isRunning = true;

      // Publicar actualización del modo via MQTT
      try {
        publishModeUpdate('heat');
      } catch (error) {
        console.warn('Error al publicar actualización de modo via MQTT:', error);
        // No fallar la operación principal por un error MQTT
      }

      return true;
    } else {
      console.log("El termostato ya está en funcionamiento");
      return true;
    }
  } catch (error) {
    const errorMsg = `Error al iniciar el termostato: ${toError(error).message}`;
    console.error(errorMsg);
    thermostatState.lastError = errorMsg;
    return false;
  }
}

/**
 * Detiene el termostato y apaga la calefacción
 */
export function stopThermostat(): boolean {
  try {
    if (thermostatState.isRunning && thermostatInterval) {
      clearInterval(thermostatInterval);
      thermostatInterval = null;

      // Asegurar que la calefacción esté apagada al detener
      let relayTurnedOff = true;
      if (thermostatState.isHeating) {
        relayTurnedOff = turnOffRelay();
        thermostatState.isHeating = false;
      }

      thermostatState.isRunning = false;
      console.log("Termostato detenido");

      // Publicar actualización del modo via MQTT
      try {
        publishModeUpdate('off');
      } catch (error) {
        console.warn('Error al publicar actualización de modo via MQTT:', error);
        // No fallar la operación principal por un error MQTT
      }
      
      return relayTurnedOff;
    }
    return true;
  } catch (error) {
    const errorMsg = `Error al detener el termostato: ${toError(error).message}`;
    console.error(errorMsg);
    thermostatState.lastError = errorMsg;
    return false;
  }
}

/**
 * Actualiza la temperatura objetivo
 */
export async function setTargetTemperature(temperature: number): Promise<boolean> {
  try {
    if (!validateTemperatureValue(temperature)) {
      throw new Error(`Temperatura fuera de rango válido: ${temperature}°C (debe estar entre 5-30°C)`);
    }
    thermostatConfig.targetTemperature = temperature;
    thermostatState.targetTemperature = temperature;
    console.log(`Temperatura objetivo actualizada a: ${temperature}°C`);

    const updatedAt = new Date();
    await SettingModel.updateOne(
      { key: "targetTemperature" },
      { $set: { value: temperature, updatedAt } },
      { upsert: true }
    );

    if (thermostatState.isRunning) {
      updateCurrentState();
      controlHeating();
    }

    // Publicar actualización del setpoint via MQTT
    try {
      publishSetpointUpdate(temperature);
    } catch (error) {
      console.warn('Error al publicar actualización de setpoint via MQTT:', error);
      // No fallar la operación principal por un error MQTT
    }

    return true;
  } catch (error) {
    const errorMsg = `Error al configurar temperatura objetivo: ${toError(error).message}`;
    console.error(errorMsg);
    thermostatState.lastError = errorMsg;
    return false;
  }
}

/**
 * Devuelve la temperatura objetivo obtenida desde la base de datos
 */
export async function getTargetTemperature(): Promise<number> {
  try {
    const dbRecord = await SettingModel.findOne({ key: "targetTemperature" }).lean();
    if (dbRecord && dbRecord.value) {
      console.log(`Temperatura objetivo obtenida de la base de datos: ${dbRecord.value}°C`);
      return dbRecord.value;
    } else {
      console.warn("No se encontró un valor válido en la base de datos, usando configuración actual.");
      return thermostatConfig.targetTemperature;
    }
  } catch (error) {
    console.error("Error al obtener la temperatura de la base de datos:", error);
    return thermostatConfig.targetTemperature;
  }
}

/**
 * Actualiza la configuración de histéresis
 */
export function setHysteresis(hysteresis: number): boolean {
  try {
    if (!validateHysteresisValue(hysteresis)) {
      throw new Error(`Valor de histéresis inválido: ${hysteresis} (debe estar entre 0.1-5°C)`);
    }
    thermostatConfig.hysteresis = hysteresis;
    console.log(`Histéresis actualizada a: ${hysteresis}°C`);
    return true;
  } catch (error) {
    const errorMsg = `Error al configurar histéresis: ${toError(error).message}`;
    console.error(errorMsg);
    thermostatState.lastError = errorMsg;
    return false;
  }
}

export function getHysteresis(): number {
  return thermostatConfig.hysteresis;
}

/**
 * Obtiene el estado actual del termostato
 */
export function getThermostatState(): ThermostatState {
  return { ...thermostatState };
}

/**
 * Obtiene la configuración actual del termostato
 */
export function getThermostatConfig(): ThermostatConfig {
  return { ...thermostatConfig };
}

/**
 * Obtiene el último error registrado
 */
export function getLastError(): string | null {
  return thermostatState.lastError;
}

/**
 * Reinicia el sistema de termostato (útil tras errores)
 */
export function resetThermostat(): boolean {
  const wasRunning = thermostatState.isRunning;
  const targetTemp = thermostatConfig.targetTemperature;
  const hysteresis = thermostatConfig.hysteresis;
  
  const stopSuccess = stopThermostat();
  if (!stopSuccess) {
    return false;
  }
  
  // Reiniciar contadores de error
  resetErrorCounter();
  thermostatState.lastError = null;
  
  // Reiniciar sólo si estaba activo anteriormente
  if (wasRunning) {
    return startThermostat({
      targetTemperature: targetTemp,
      hysteresis: hysteresis
    });
  }
  
  return true;
}

// Funciones internas

/**
 * Notifica a los manejadores registrados sobre un error crítico
 */
function notifyCriticalError(errorMessage: string): void {
  errorHandlers.forEach(handler => {
    try {
      handler(errorMessage);
    } catch (error) {
      console.error("Error al ejecutar manejador de errores:", error);
    }
  });
}

/**
 * Actualiza el estado actual leyendo la temperatura del sensor
 * @returns boolean indicando si la actualización fue exitosa
 */
function updateCurrentState(): boolean {
  try {
    const temperature = getTemperature();
    resetErrorCounter();
    thermostatState.currentTemperature = temperature;
    thermostatState.isHeating = getRelayState();
    thermostatState.lastUpdated = new Date();
    return true;
  } catch (error) {
    handleSensorError(toError(error));
    return false;
  }
}

/**
 * Controla la calefacción según la temperatura y la histéresis
 */
function controlHeating(): void {
  try {
    if (!thermostatState.isRunning) return;
    const { targetTemperature, hysteresis } = thermostatConfig;
    const { currentTemperature, isHeating } = thermostatState;
    const now = Date.now();
    const lowerLimit = targetTemperature - hysteresis;
    const upperLimit = targetTemperature;
    const minActionInterval = 30000;
    if (now - lastControlAction < minActionInterval) {
      return;
    }
    if (isHeating) {
      if (currentTemperature >= upperLimit) {
        const success = turnOffRelay();
        if (success) {
          thermostatState.isHeating = false;
          lastControlAction = now;
          console.log(`Apagando calefacción: Temperatura actual ${currentTemperature}°C alcanzó el objetivo ${upperLimit}°C`);
        } else {
          console.error(`Error al intentar apagar el relé a ${upperLimit}°C`);
          thermostatState.lastError = "Error al intentar apagar la calefacción";
        }
      }
    } else {
      if (currentTemperature < lowerLimit) {
        const success = turnOnRelay();
        if (success) {
          thermostatState.isHeating = true;
          lastControlAction = now;
          console.log(`Encendiendo calefacción: Temperatura actual ${currentTemperature}°C por debajo del límite inferior ${lowerLimit}°C`);
        } else {
          console.error(`Error al intentar encender el relé a ${lowerLimit}°C`);
          thermostatState.lastError = "Error al intentar encender la calefacción";
        }
      }
    }
  } catch (error) {
    const errorMsg = `Error al controlar calefacción: ${toError(error).message}`;
    console.error(errorMsg);
    thermostatState.lastError = errorMsg;
  }
}

/**
 * Manejo de errores del sensor
 */
function handleSensorError(error: Error) {
  thermostatState.consecutiveErrors++;
  thermostatState.lastError = error.message;
  console.error(`[SENSOR] Error consecutivo #${thermostatState.consecutiveErrors}: ${error.message}`);
  if (thermostatState.consecutiveErrors >= thermostatConfig.maxConsecutiveErrors) {
    console.error(`[SENSOR] Se alcanzó el máximo de errores consecutivos (${thermostatConfig.maxConsecutiveErrors}). El termostato se pausará hasta que se recupere el sensor.`);
    thermostatState.isRunning = false;
    if (thermostatInterval) {
      clearInterval(thermostatInterval);
      thermostatInterval = null;
    }
    notifyCriticalError(`Sensor error: Se pausó el termostato por demasiados errores consecutivos de sensor.`);
  }
}

/**
 * Reinicia el contador de errores
 */
function resetErrorCounter() {
  thermostatState.consecutiveErrors = 0;
}

/**
 * Convierte un error desconocido a tipo Error
 */
function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Valida el rango de temperatura
 */
export function validateTemperatureValue(temperature: number): boolean {
  return typeof temperature === 'number' && !isNaN(temperature) && temperature >= 5 && temperature <= 30;
}

/**
 * Valida el rango de histéresis
 */
export function validateHysteresisValue(hysteresis: number): boolean {
  return typeof hysteresis === 'number' && !isNaN(hysteresis) && hysteresis > 0 && hysteresis <= 5;
}

/**
 * Obtiene la temperatura objetivo y la histéresis desde la base de datos
 */
export async function getTargetTemperatureAndHysteresis(): Promise<{ targetTemperature: number; hysteresis: number }> {
  try {
    const dbRecord = await SettingModel.findOne({ key: "targetTemperature" }).lean();
    const targetTemperature = dbRecord?.value || DEFAULT_CONFIG.targetTemperature;
    const hysteresis = dbRecord?.hysteresis || DEFAULT_CONFIG.hysteresis;

    console.log(`Configuración obtenida de la base de datos: targetTemperature=${targetTemperature}°C, hysteresis=${hysteresis}°C`);
    return { targetTemperature, hysteresis };
  } catch (error) {
    console.error("Error al obtener configuración de la base de datos:", error);
    return { targetTemperature: DEFAULT_CONFIG.targetTemperature, hysteresis: DEFAULT_CONFIG.hysteresis };
  }
}

// Actualizo el estado inicial del termostato usando la configuración de la base de datos
(async () => {
  const config = await getTargetTemperatureAndHysteresis();
  thermostatState.targetTemperature = config.targetTemperature;
  thermostatState.hysteresis = config.hysteresis;
})();
