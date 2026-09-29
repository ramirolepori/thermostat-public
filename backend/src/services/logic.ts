import { getTemperature } from "../hardware/sensor";
import { turnOnRelay, turnOffRelay, getRelayState } from "../hardware/relay";
import { publishModeUpdate } from "./mqtt"; // Importar función MQTT para publicar actualizaciones
import { getFreshExternalSources } from "./temperatureSources"; // Fuentes externas de temperatura (HomePods)
import { computeDesiredRelay, resetTPI, DEFAULT_TPI } from "./tpiController"; // Control TPI de la calefacción
import { loadPersistedState, savePersistedState } from "./persistence"; // Persistencia del setpoint a disco

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
  targetTemperature: 20, // 20°C por defecto (solo en el primer arranque sin estado persistido)
  hysteresis: 1.5, // Diferencial de 1.5°C
  checkIntervalMs: 3000, // Revisar cada 3 segundos (mejora de performance)
  maxConsecutiveErrors: 5, // Máximo de errores consecutivos antes del fail-safe
};

// Cargar el último setpoint persistido (sobrevive a reinicios y cortes de luz).
// Si no hay archivo o es inválido, se usa el default.
const persisted = loadPersistedState();
const initialTarget =
  typeof persisted.targetTemperature === 'number' && validateTemperatureValue(persisted.targetTemperature)
    ? persisted.targetTemperature
    : DEFAULT_CONFIG.targetTemperature;

// Estado inicial
let thermostatState: ThermostatState = {
  currentTemperature: 0,
  targetTemperature: initialTarget,
  hysteresis: DEFAULT_CONFIG.hysteresis,
  isHeating: false,
  lastUpdated: new Date(),
  isRunning: false,
  lastError: null,
  consecutiveErrors: 0,
};

let thermostatConfig: ThermostatConfig = { ...DEFAULT_CONFIG, targetTemperature: initialTarget };
let thermostatInterval: NodeJS.Timeout | null = null;
let isUpdating = false; // Evita que dos ciclos de lectura se solapen si el sensor tarda
let failSafeActive = false; // True mientras el fail-safe mantiene la caldera apagada por falta de sensor

/**
 * Guarda en disco el setpoint y el modo on/off actuales (fire-and-forget).
 * Sobrevive a reinicios del proceso y cortes de luz.
 */
function persistState(): void {
  void savePersistedState({
    targetTemperature: thermostatConfig.targetTemperature,
    isRunning: thermostatState.isRunning,
  });
}

/**
 * Indica si el termostato debe arrancar automáticamente al iniciar el proceso,
 * según el último modo persistido. Si nunca se persistió (primer arranque) o
 * estaba encendido, arranca; solo NO arranca si el usuario lo había dejado en OFF.
 */
export function wasRunningPersisted(): boolean {
  return persisted.isRunning !== false;
}

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
    // Actualizar configuración con los valores proporcionados, preservando la
    // config actual (sobre todo el setpoint persistido). Antes se reconstruía
    // desde DEFAULT_CONFIG, lo que reseteaba el setpoint al apagar/prender el
    // termostato desde HomeKit.
    thermostatConfig = {
      ...thermostatConfig,
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
      resetTPI(); // Reiniciar el controlador TPI (integral y ciclo)
      // Lectura inicial en segundo plano: no bloqueamos el arranque por el sensor.
      updateCurrentState().then((ok) => {
        if (!ok) {
          console.warn("Advertencia: No se pudo leer la temperatura inicial, iniciando con valores predeterminados");
        }
      });

      // Iniciar el intervalo para revisar la temperatura periódicamente
      thermostatInterval = setInterval(() => {
        // Si el ciclo anterior sigue leyendo el sensor, saltar este tick.
        if (isUpdating) return;
        runControlCycle();
      }, thermostatConfig.checkIntervalMs);

      thermostatState.isRunning = true;
      persistState(); // Recordar que quedó encendido (sobrevive a reinicios/cortes)

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
      persistState(); // Recordar que quedó apagado (no reencender solo tras reinicio)
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

    // Persistir el nuevo setpoint a disco para que sobreviva a reinicios y
    // cortes de luz (fire-and-forget: un fallo de E/S no debe romper el control).
    persistState();

    // Recalcular el relé de inmediato con el nuevo setpoint, pero solo si no hay
    // un ciclo de control en vuelo: así no se solapan dos lecturas/escrituras.
    // Si hay uno corriendo, ya tomará el nuevo setpoint (controlHeating lee la
    // config actualizada) o lo hará el próximo tick (≤3 s).
    if (thermostatState.isRunning && !isUpdating) {
      await runControlCycle();
    }

    // No se re-publica el setpoint acá a propósito: el eco inmediato causaba el
    // "rebote" del display en HomeKit al cambiar el setpoint (ver mqtt.ts,
    // handleSetpointCommand). El publish periódico reafirma el valor actual.

    return true;
  } catch (error) {
    const errorMsg = `Error al configurar temperatura objetivo: ${toError(error).message}`;
    console.error(errorMsg);
    thermostatState.lastError = errorMsg;
    return false;
  }
}

/**
 * Devuelve la temperatura objetivo actual (en memoria).
 */
export function getTargetTemperature(): number {
  return thermostatConfig.targetTemperature;
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

// Monitor de temperatura para display: mantiene `currentTemperature` fresca
// incluso con el termostato APAGADO, así HomeKit/HA siguen mostrando la
// temperatura del ambiente (si no, al arrancar en OFF quedaría en 0°C). Cuando
// el termostato está encendido, el loop de control ya lee el sensor y este
// monitor no hace nada.
let monitorInterval: NodeJS.Timeout | null = null;
const MONITOR_INTERVAL_MS = 30000;

export function startTemperatureMonitor(): void {
  if (monitorInterval) return;
  const tick = async () => {
    if (thermostatState.isRunning) return; // el loop de control ya actualiza la temp
    try {
      const t = await getTemperature();
      thermostatState.currentTemperature = Math.round(t * 1000) / 1000;
      thermostatState.lastUpdated = new Date();
    } catch {
      // Lectura inválida transitoria (ej. CRC del DS18B20): ignorar, sin tocar
      // el fail-safe (que es solo para el modo de control activo).
    }
  };
  void tick(); // primera lectura inmediata para no mostrar 0°C al arrancar en OFF
  monitorInterval = setInterval(tick, MONITOR_INTERVAL_MS);
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
 * Ejecuta un ciclo de control: lee el sensor y, si la lectura fue válida,
 * decide si encender/apagar la calefacción. Protegido contra reentrancia por
 * el flag `isUpdating` del intervalo.
 */
async function runControlCycle(): Promise<void> {
  isUpdating = true;
  try {
    const ok = await updateCurrentState();
    if (ok) {
      controlHeating();
    }
  } finally {
    isUpdating = false;
  }
}

/**
 * Actualiza el estado actual combinando el sensor local DS18B20 con las fuentes
 * externas frescas (HomePods). La temperatura efectiva es el promedio de todas
 * las muestras válidas disponibles.
 *
 * Una lectura local fallida (ej. CRC inválido) no es un error si hay al menos
 * una fuente externa fresca: el termostato sigue operando con ella. Solo cuando
 * NO hay ninguna fuente válida se considera un error de sensor (y se activa el
 * fail-safe tras demasiados errores consecutivos).
 *
 * @returns boolean indicando si se pudo determinar una temperatura válida
 */
async function updateCurrentState(): Promise<boolean> {
  // Lectura local: tolera fallo si hay fuentes externas.
  let localTemp: number | null = null;
  try {
    localTemp = await getTemperature();
  } catch (error) {
    console.warn(`[SENSOR] Lectura local DS18B20 fallida: ${toError(error).message}`);
  }

  const externalSamples = getFreshExternalSources().map((s) => s.value);
  const samples = localTemp !== null ? [localTemp, ...externalSamples] : externalSamples;

  if (samples.length === 0) {
    handleSensorError(new Error('Sin fuentes de temperatura válidas (DS18B20 ni HomePods)'));
    return false;
  }

  const effectiveTemp = samples.reduce((a, b) => a + b, 0) / samples.length;
  resetErrorCounter();
  // Recuperación del fail-safe: volvió una lectura válida tras una racha de
  // errores. El control normal se reanuda solo (controlHeating se vuelve a
  // ejecutar en este mismo ciclo).
  if (failSafeActive) {
    failSafeActive = false;
    console.log('[SENSOR] Lecturas válidas recuperadas: se reanuda el control normal de la caldera.');
  }
  thermostatState.currentTemperature = Math.round(effectiveTemp * 1000) / 1000;
  thermostatState.isHeating = getRelayState();
  thermostatState.lastUpdated = new Date();
  // Una actualización válida limpia el último error transitorio (ej. CRC del
  // DS18B20) para no dejar un error fantasma colgado en el estado/UI.
  thermostatState.lastError = null;
  return true;
}

/**
 * Controla la calefacción mediante el controlador TPI (time-proportional).
 * El TPI decide encendido/apagado modulando un duty cycle según el error de
 * temperatura; reemplaza al on/off con histéresis para mantener la temperatura
 * mucho más estable y con un número acotado de ciclos de caldera por hora.
 */
function controlHeating(): void {
  try {
    if (!thermostatState.isRunning) return;
    const setpoint = thermostatConfig.targetTemperature;
    const temp = thermostatState.currentTemperature;
    const decision = computeDesiredRelay(temp, setpoint, DEFAULT_TPI, Date.now());

    if (decision.on && !thermostatState.isHeating) {
      if (turnOnRelay()) {
        thermostatState.isHeating = true;
        console.log(`Caldera ON (TPI ${decision.mode}, duty ${(decision.duty * 100).toFixed(0)}%) — temp ${temp}°C / objetivo ${setpoint}°C`);
      } else {
        console.error('Error al intentar encender el relé');
        thermostatState.lastError = 'Error al intentar encender la calefacción';
      }
    } else if (!decision.on && thermostatState.isHeating) {
      if (turnOffRelay()) {
        thermostatState.isHeating = false;
        console.log(`Caldera OFF (TPI ${decision.mode}, duty ${(decision.duty * 100).toFixed(0)}%) — temp ${temp}°C / objetivo ${setpoint}°C`);
      } else {
        console.error('Error al intentar apagar el relé');
        thermostatState.lastError = 'Error al intentar apagar la calefacción';
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
    // Fail-safe: apagar la caldera (nunca quemar a ciegas sin lecturas
    // confiables), pero MANTENER el termostato corriendo para seguir
    // reintentando. Al volver una lectura válida, el control se reanuda solo
    // (ver updateCurrentState). Antes esto detenía el termostato de forma
    // permanente y requería intervención manual para recuperar la calefacción.
    if (thermostatState.isHeating) {
      turnOffRelay();
      thermostatState.isHeating = false;
    }

    // Notificar una sola vez al entrar al fail-safe (no spamear en cada ciclo).
    if (!failSafeActive) {
      failSafeActive = true;
      console.error(`[SENSOR] Fail-safe activado: caldera apagada por ${thermostatState.consecutiveErrors} errores consecutivos de sensor. Se sigue reintentando.`);
      notifyCriticalError('Sensor error: se apagó la calefacción por errores consecutivos de sensor. El termostato sigue activo y reanudará al recuperar lecturas.');
    }
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

