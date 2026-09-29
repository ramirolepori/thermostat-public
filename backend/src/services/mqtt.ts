import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { getThermostatState, setTargetTemperature } from './logic';
import { getRelayState } from '../hardware/relay';

// Configuración MQTT
interface MqttConfig {
  brokerUrl: string;
  clientId: string;
  topics: {
    // Topics de estado (publicación)
    temperature: string;
    relay: string;
    setpoint: string;
    online: string;
    mode: string;
    // Topics de comando (suscripción)
    setpointSet: string;
    modeSet: string;
  };
  publishInterval: number; // Intervalo de publicación en ms
  reconnectPeriod: number; // Período de reconexión en ms
  connectTimeout: number; // Timeout de conexión en ms
}

// Configuración predeterminada
const DEFAULT_MQTT_CONFIG: MqttConfig = {
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  clientId: process.env.MQTT_CLIENT_ID || `termostato_${Math.random().toString(16).substr(2, 8)}`,
  topics: {
    temperature: 'termostato/status/temperature',
    relay: 'termostato/status/relay',
    setpoint: 'termostato/status/setpoint',
    online: 'termostato/status/online',
    mode: 'termostato/status/mode',
    setpointSet: 'termostato/setpoint/set',
    modeSet: 'termostato/mode/set'
  },
  publishInterval: 10000, // Publicar cada 10 segundos
  reconnectPeriod: 5000,  // Intentar reconectar cada 5 segundos
  connectTimeout: 30000   // Timeout de 30 segundos
};

// Estado del servicio MQTT
interface MqttServiceState {
  isConnected: boolean;
  isEnabled: boolean;
  lastPublishTime: Date | null;
  lastError: string | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// Variables globales del servicio
let mqttClient: MqttClient | null = null;
let mqttConfig: MqttConfig = { ...DEFAULT_MQTT_CONFIG };
let publishInterval: NodeJS.Timeout | null = null;
let serviceState: MqttServiceState = {
  isConnected: false,
  isEnabled: false,
  lastPublishTime: null,
  lastError: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10
};

// Tipos para los payloads JSON
interface TemperaturePayload {
  value: number;
  timestamp?: string;
}

interface SetpointPayload {
  value: number;
  timestamp?: string;
}

interface ModePayload {
  value: string;
  timestamp?: string;
}

/**
 * Valida y parsea un payload JSON
 */
function parseJsonPayload<T>(message: Buffer, expectedFields: string[]): T | null {
  try {
    const payload = JSON.parse(message.toString());
    
    // Verificar que todos los campos requeridos estén presentes
    for (const field of expectedFields) {
      if (!(field in payload)) {
        console.error(`Campo requerido '${field}' no encontrado en el payload MQTT`);
        return null;
      }
    }
    
    return payload as T;
  } catch (error) {
    console.error('Error al parsear payload JSON MQTT:', error);
    return null;
  }
}

/**
 * Publica un mensaje en un topic específico
 */
function publishMessage(topic: string, payload: object): void {
  if (!mqttClient || !serviceState.isConnected) {
    console.warn(`No se puede publicar en ${topic}: cliente MQTT no conectado`);
    return;
  }

  try {
    const message = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString()
    });

    mqttClient.publish(topic, message, { qos: 0, retain: true }, (error) => {
      if (error) {
        console.error(`Error al publicar en ${topic}:`, error.message);
        serviceState.lastError = error.message;
      } else {
        console.log(`✅ Publicado en ${topic}:`, message);
      }
    });
  } catch (error) {
    const errorMsg = `Error al preparar mensaje para ${topic}: ${error}`;
    console.error(errorMsg);
    serviceState.lastError = errorMsg;
  }
}

/**
 * Publica el estado actual del termostato
 */
function publishThermostatStatus(): void {
  if (!serviceState.isConnected) return;

  try {
    const thermostatState = getThermostatState();
    const relayState = getRelayState();

    // Publicar temperatura actual
    publishMessage(mqttConfig.topics.temperature, {
      value: thermostatState.currentTemperature
    });

    // Publicar estado del relé
    publishMessage(mqttConfig.topics.relay, {
      value: relayState
    });

    // Publicar setpoint actual
    publishMessage(mqttConfig.topics.setpoint, {
      value: thermostatState.targetTemperature
    });

    // Publicar modo del termostato (heat si está funcionando, off si está parado)
    publishMessage(mqttConfig.topics.mode, {
      value: thermostatState.isRunning ? 'heat' : 'off'
    });

    serviceState.lastPublishTime = new Date();
    serviceState.lastError = null; // Limpiar errores si la publicación fue exitosa

  } catch (error) {
    const errorMsg = `Error al publicar estado del termostato: ${error}`;
    console.error(errorMsg);
    serviceState.lastError = errorMsg;
  }
}

/**
 * Maneja comandos recibidos para cambiar el setpoint
 */
async function handleSetpointCommand(message: Buffer): Promise<void> {
  const payload = parseJsonPayload<SetpointPayload>(message, ['value']);
  if (!payload) return;

  const { value } = payload;

  if (typeof value !== 'number' || isNaN(value)) {
    console.error('Valor de setpoint inválido recibido via MQTT:', value);
    return;
  }

  console.log(`📥 Comando MQTT recibido: cambiar setpoint a ${value}°C`);

  try {
    const success = await setTargetTemperature(value);
    if (success) {
      console.log(`✅ Setpoint actualizado via MQTT: ${value}°C`);
      // NO re-publicar el setpoint acá: HA ya muestra el valor que ordenó. Al
      // arrastrar el setpoint en HomeKit llegan varias órdenes seguidas
      // (17,5/18/…/20) y, si las eco-publicábamos, los ecos llegaban
      // desordenados (20→19,5→20) y el display "rebotaba". El publish periódico
      // (cada 10s) ya reafirma el valor actual sin valores intermedios viejos.
    } else {
      console.error(`❌ Error al actualizar setpoint via MQTT: ${value}°C`);
    }
  } catch (error) {
    console.error('Error al procesar comando de setpoint via MQTT:', error);
  }
}

/**
 * Maneja comandos recibidos para cambiar el modo del termostato
 */
async function handleModeCommand(message: Buffer): Promise<void> {
  const payload = parseJsonPayload<ModePayload>(message, ['value']);
  if (!payload) return;

  const { value } = payload;

  if (typeof value !== 'string' || !['heat', 'off'].includes(value)) {
    console.error('Valor de modo inválido recibido via MQTT:', value);
    return;
  }

  console.log(`📥 Comando MQTT recibido: cambiar modo a ${value}`);

  try {
    // Importar funciones del servicio de lógica dinámicamente para evitar imports circulares
    const { startThermostat, stopThermostat } = await import('./logic');
    
    if (value === 'heat') {
      const success = startThermostat();
      if (success) {
        console.log('✅ Termostato encendido via MQTT');
      } else {
        console.error('❌ Error al encender termostato via MQTT');
      }
    } else if (value === 'off') {
      const success = stopThermostat();
      if (success) {
        console.log('✅ Termostato apagado via MQTT');
      } else {
        console.error('❌ Error al apagar termostato via MQTT');
      }
    }

    // Publicar inmediatamente el nuevo modo
    publishMessage(mqttConfig.topics.mode, { value });
  } catch (error) {
    console.error('Error al procesar comando de modo via MQTT:', error);
  }
}

/**
 * Configura las suscripciones a topics de comando
 */
function setupSubscriptions(): void {
  if (!mqttClient) return;

  const subscriptionTopics = [
    mqttConfig.topics.setpointSet,
    mqttConfig.topics.modeSet
  ];

  subscriptionTopics.forEach(topic => {
    mqttClient!.subscribe(topic, { qos: 0 }, (error) => {
      if (error) {
        console.error(`Error al suscribirse a ${topic}:`, error.message);
        serviceState.lastError = error.message;
      } else {
        console.log(`✅ Suscrito a topic: ${topic}`);
      }
    });
  });

  // Configurar el manejador de mensajes
  mqttClient.on('message', async (topic, message) => {
    console.log(`📨 Mensaje MQTT recibido en ${topic}:`, message.toString());

    try {
      switch (topic) {
        case mqttConfig.topics.setpointSet:
          await handleSetpointCommand(message);
          break;
        case mqttConfig.topics.modeSet:
          await handleModeCommand(message);
          break;
        default:
          console.warn(`Topic no manejado: ${topic}`);
      }
    } catch (error) {
      console.error(`Error al procesar mensaje de ${topic}:`, error);
    }
  });
}

/**
 * Inicializa el cliente MQTT y establece la conexión
 */
export function initializeMqtt(config?: Partial<MqttConfig>): void {
  // Merge con configuración personalizada si se proporciona
  if (config) {
    mqttConfig = { ...mqttConfig, ...config };
  }

  console.log(`🔌 Inicializando cliente MQTT...`);
  console.log(`📡 Broker: ${mqttConfig.brokerUrl}`);
  console.log(`🆔 Client ID: ${mqttConfig.clientId}`);

  const options: IClientOptions = {
    clientId: mqttConfig.clientId,
    clean: true,
    reconnectPeriod: mqttConfig.reconnectPeriod,
    connectTimeout: mqttConfig.connectTimeout,
    will: {
      topic: mqttConfig.topics.online,
      payload: JSON.stringify({ value: false, timestamp: new Date().toISOString() }),
      qos: 0,
      retain: true
    }
  };

  try {
    mqttClient = mqtt.connect(mqttConfig.brokerUrl, options);

    // Evento de conexión exitosa
    mqttClient.on('connect', () => {
      console.log('✅ Cliente MQTT conectado exitosamente');
      serviceState.isConnected = true;
      serviceState.reconnectAttempts = 0;
      serviceState.lastError = null;

      // Publicar estado online
      publishMessage(mqttConfig.topics.online, { value: true });

      // Configurar suscripciones
      setupSubscriptions();

      // Publicar estado inicial
      publishThermostatStatus();

      // Iniciar publicación periódica
      if (publishInterval) {
        clearInterval(publishInterval);
      }
      publishInterval = setInterval(publishThermostatStatus, mqttConfig.publishInterval);
    });

    // Evento de desconexión
    mqttClient.on('disconnect', () => {
      console.warn('⚠️ Cliente MQTT desconectado');
      serviceState.isConnected = false;
    });

    // Evento de error
    mqttClient.on('error', (error) => {
      console.error('❌ Error del cliente MQTT:', error.message);
      serviceState.lastError = error.message;
      serviceState.isConnected = false;
    });

    // Evento de reconexión
    mqttClient.on('reconnect', () => {
      serviceState.reconnectAttempts++;
      console.log(`🔄 Intentando reconectar MQTT (intento ${serviceState.reconnectAttempts}/${serviceState.maxReconnectAttempts})...`);
      
      if (serviceState.reconnectAttempts >= serviceState.maxReconnectAttempts) {
        console.error('❌ Máximo número de intentos de reconexión alcanzado. Deteniendo cliente MQTT.');
        stopMqtt();
      }
    });

    // Evento de cierre
    mqttClient.on('close', () => {
      console.log('🔌 Conexión MQTT cerrada');
      serviceState.isConnected = false;
    });

    serviceState.isEnabled = true;

  } catch (error) {
    const errorMsg = `Error al inicializar cliente MQTT: ${error}`;
    console.error(errorMsg);
    serviceState.lastError = errorMsg;
    serviceState.isEnabled = false;
  }
}

/**
 * Detiene el servicio MQTT
 */
export function stopMqtt(): void {
  console.log('🛑 Deteniendo servicio MQTT...');

  serviceState.isEnabled = false;

  // Detener la publicación periódica
  if (publishInterval) {
    clearInterval(publishInterval);
    publishInterval = null;
  }

  // Cerrar la conexión MQTT
  if (mqttClient) {
    // Publicar estado offline antes de desconectar
    if (serviceState.isConnected) {
      publishMessage(mqttConfig.topics.online, { value: false });
    }

    mqttClient.end(true, {}, () => {
      console.log('✅ Cliente MQTT desconectado correctamente');
    });

    mqttClient = null;
  }

  // Resetear estado
  serviceState.isConnected = false;
  serviceState.lastPublishTime = null;
  serviceState.reconnectAttempts = 0;

  console.log('✅ Servicio MQTT detenido');
}

/**
 * Publica inmediatamente el setpoint actualizado (para uso desde otras partes del sistema)
 */
export function publishSetpointUpdate(newSetpoint: number): void {
  if (serviceState.isConnected) {
    publishMessage(mqttConfig.topics.setpoint, { value: newSetpoint });
  }
}

/**
 * Publica inmediatamente el modo actualizado (para uso desde otras partes del sistema)
 */
export function publishModeUpdate(newMode: string): void {
  if (serviceState.isConnected && ['heat', 'off'].includes(newMode)) {
    publishMessage(mqttConfig.topics.mode, { value: newMode });
  }
}

/**
 * Obtiene el estado actual del servicio MQTT
 */
export function getMqttServiceState(): MqttServiceState & { config: MqttConfig } {
  return {
    ...serviceState,
    config: { ...mqttConfig }
  };
}

/**
 * Reinicia el servicio MQTT
 */
export function restartMqtt(): void {
  console.log('🔄 Reiniciando servicio MQTT...');
  stopMqtt();
  
  // Esperar un momento antes de reiniciar
  setTimeout(() => {
    initializeMqtt();
  }, 2000);
}

/**
 * Verifica si el servicio MQTT está funcionando correctamente
 */
export function isMqttHealthy(): boolean {
  return serviceState.isEnabled && serviceState.isConnected && serviceState.lastError === null;
}
