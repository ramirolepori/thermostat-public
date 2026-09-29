import { Router, Request, Response, NextFunction } from 'express';
import { getTemperature, getLastTemperature } from '../hardware/sensor';
import { recordExternalTemperature, getAllExternalSources } from '../services/temperatureSources';
import { getTPIState } from '../services/tpiController';
import { 
  getHysteresis,
  getTargetTemperature, 
  setTargetTemperature, 
  startThermostat, 
  stopThermostat, 
  setHysteresis, 
  getThermostatState,
  getLastError,
  resetThermostat,
  validateTemperatureValue,
  validateHysteresisValue
} from '../services/logic';
import { 
  getMqttServiceState, 
  restartMqtt, 
  isMqttHealthy 
} from '../services/mqtt';

// Versión única desde package.json (evita números de versión duplicados/desfasados).
const { version: APP_VERSION } = require('../../package.json') as { version: string };

const router = Router();

// Interfaces para los tipos de las solicitudes
interface TemperatureRequest extends Request {
  body: {
    temperature?: number;
  }
}

interface HysteresisRequest extends Request {
  body: {
    hysteresis?: number;
  }
}

interface ThermostatConfigRequest extends Request {
  body: {
    targetTemperature?: number;
    hysteresis?: number;
  }
}

// Middleware para validación de parámetros de temperatura usando lógica centralizada
const validateTemperature = (req: TemperatureRequest, res: Response, next: NextFunction) => {
  const temperature = req.body.temperature;
  if (temperature === undefined || temperature === null) {
    return res.status(400).json({ error: 'No se proporcionó un valor de temperatura' });
  }
  if (!validateTemperatureValue(temperature)) {
    return res.status(400).json({ error: 'La temperatura debe estar entre 5°C y 30°C' });
  }
  next();
};

// Middleware para validación de histéresis usando lógica centralizada
const validateHysteresis = (req: HysteresisRequest, res: Response, next: NextFunction) => {
  const hysteresis = req.body.hysteresis;
  if (hysteresis === undefined || hysteresis === null) {
    return res.status(400).json({ error: 'No se proporcionó un valor de histéresis' });
  }
  if (!validateHysteresisValue(hysteresis)) {
    return res.status(400).json({ error: 'La histéresis debe ser un valor positivo entre 0.1 y 5' });
  }
  next();
};

// Ruta de prueba para comprobar que el servidor está funcionando
router.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// Ruta de comprobación de estado del sistema
router.get('/health', (_req: Request, res: Response) => {
  try {
    const lastError = getLastError();
    const thermostatState = getThermostatState();
    
    res.status(200).json({
      status: 'ok',
      version: APP_VERSION,
      uptime: process.uptime(),
      thermostatRunning: thermostatState.isRunning,
      lastError: lastError,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error en endpoint /health:', error);
    res.status(500).json({ 
      status: 'error',
      error: 'Error al verificar estado del sistema',
      timestamp: new Date().toISOString()
    });
  }
});

// Ruta de temperatura. Devuelve la temperatura EFECTIVA (promedio de DS18B20 +
// HomePods frescos) que el ciclo de control mantiene en el estado. Si el loop
// aún no corrió (estado sin actualizar), hace una lectura local on-demand.
router.get('/temperature', async (_req: Request, res: Response) => {
  try {
    const state = getThermostatState();
    let temp: number | null = state.lastUpdated ? state.currentTemperature : null;

    // Solo re-leer si no hay valor del loop. (Antes también re-leía con temp===0,
    // lo que trataba 0°C real como "sin lectura".)
    if (temp === null) {
      temp = getLastTemperature() ?? (await getTemperature());
    }

    res.set('Cache-Control', 'private, max-age=1');
    res.status(200).json({ temperature: temp });
  } catch (error) {
    console.error('Error en endpoint /temperature:', error);
    res.status(500).json({ error: 'Error al obtener la temperatura del sensor' });
  }
});

// Ingesta de temperatura desde fuentes externas (ej. HomePods vía Atajos de iOS).
// Body: { id: string, value: number }  ->  el backend la promedia con el DS18B20.
router.post('/external-temperature', (req: Request, res: Response) => {
  try {
    const { id, value } = req.body ?? {};

    if (typeof id !== 'string' || id.trim() === '') {
      return res.status(400).json({ error: 'Falta el campo "id" (identificador de la fuente)' });
    }
    if (typeof value !== 'number' || isNaN(value)) {
      return res.status(400).json({ error: 'El campo "value" debe ser un número (°C)' });
    }

    const entry = recordExternalTemperature(id.trim(), value);
    return res.status(200).json({ ok: true, id: entry.id, value: entry.value });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Lectura externa inválida' });
  }
});

// Estado del termostato con caché ETags
let lastStateETag = '';

// Estado caldera
router.get('/status', (req: Request, res: Response) => {
  try {
    // Obtener estado actualizado del termostato
    const thermostatState = getThermostatState();
    
    // Generar ETag basado en los datos
    const stateHash = JSON.stringify(thermostatState);
    const etag = Buffer.from(stateHash).toString('base64').substring(0, 16);
    
    // Verificar si el cliente ya tiene la versión más reciente
    if (req.headers['if-none-match'] === etag && lastStateETag === etag) {
      return res.status(304).end();
    }
    
    // Actualizar ETag en caché
    lastStateETag = etag;

    // Establecer cabeceras para caching
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, max-age=1');
    
    // Enviar respuesta con los datos
    res.status(200).json({
      currentTemperature: thermostatState.currentTemperature,
      targetTemperature: thermostatState.targetTemperature,
      hysteresis: thermostatState.hysteresis,
      isHeating: thermostatState.isHeating,
      lastUpdated: thermostatState.lastUpdated,
      isRunning: thermostatState.isRunning,
      lastError: thermostatState.lastError,
      // Fuentes externas de temperatura (HomePods) y su frescura, para diagnóstico.
      externalSources: getAllExternalSources(),
      // Estado del controlador TPI (duty cycle e integral), para diagnóstico.
      tpi: getTPIState()
    });
  } catch (error) {
    console.error('Error en endpoint /status:', error);
    res.status(500).json({ error: 'Error interno al obtener el estado del termostato' });
  }
});

// Obtener temperatura objetivo
router.get('/target-temperature', async (_req: Request, res: Response) => {
  try {
    const targetTemperature = await getTargetTemperature();
    res.set('Cache-Control', 'private, max-age=5');
    res.status(200).json({ target: targetTemperature });
  } catch (error) {
    console.error('Error en endpoint /target-temperature:', error);
    res.status(500).json({ error: 'Error interno al obtener la temperatura objetivo' });
  }
});

// Obtener hysteresis
router.get('/hysteresis', (_req: Request, res: Response) => {
  try {
    const hysteresis = getHysteresis();
    res.set('Cache-Control', 'private, max-age=5');
    res.status(200).json({ hysteresis });
  } catch (error) {
    console.error('Error en endpoint /hysteresis:', error);
    res.status(500).json({ error: 'Error interno al obtener la histéresis' });
  }
});

// Establecer temperatura objetivo usando middleware de validación
router.post('/target-temperature', validateTemperature, async (req: TemperatureRequest, res: Response) => {
  try {
    const { temperature } = req.body;

    // Ya validado por el middleware
    const success = await setTargetTemperature(temperature!);

    if (!success) {
      const lastError = getLastError();
      return res.status(400).json({ 
        error: lastError || 'Error al establecer la temperatura objetivo'
      });
    }

    // Invalidar caché de estado
    lastStateETag = '';

    res.status(200).json({ targetTemperature: temperature });
  } catch (error) {
    console.error('Error en endpoint /target-temperature:', error);
    res.status(500).json({ error: 'Error interno al establecer la temperatura objetivo' });
  }
});

// Establecer hysteresis usando middleware de validación
router.post('/hysteresis', validateHysteresis, (req: HysteresisRequest, res: Response) => {
  try {
    const { hysteresis } = req.body;
    
    // Ya validado por el middleware
    const success = setHysteresis(hysteresis!);
    
    if (!success) {
      const lastError = getLastError();
      return res.status(400).json({ 
        error: lastError || 'Error al establecer la histéresis'
      });
    }
    
    // Invalidar caché
    lastStateETag = '';
    
    res.status(200).json({ hysteresis });
  } catch (error) {
    console.error('Error en endpoint /hysteresis:', error);
    res.status(500).json({ error: 'Error interno al establecer la histéresis' });
  }
});

// Iniciar termostato
router.post('/thermostat/start', (req: ThermostatConfigRequest, res: Response) => {
  try {
    const { targetTemperature, hysteresis } = req.body;
    const config: { targetTemperature?: number; hysteresis?: number } = {};
    
    // Validar temperatura objetivo si se proporciona
    if (targetTemperature !== undefined) {
      if (typeof targetTemperature !== 'number' || isNaN(targetTemperature)) {
        return res.status(400).json({ error: 'La temperatura objetivo debe ser un valor numérico válido' });
      }
      
      if (!validateTemperatureValue(targetTemperature)) {
        return res.status(400).json({ error: 'La temperatura objetivo debe estar entre 5°C y 30°C' });
      }
      
      config.targetTemperature = targetTemperature;
    }
    
    // Validar histéresis si se proporciona
    if (hysteresis !== undefined) {
      if (typeof hysteresis !== 'number' || isNaN(hysteresis)) {
        return res.status(400).json({ error: 'La histéresis debe ser un valor numérico válido' });
      }
      
      if (!validateHysteresisValue(hysteresis)) {
        return res.status(400).json({ error: 'La histéresis debe ser un valor positivo entre 0.1 y 5' });
      }
      
      config.hysteresis = hysteresis;
    }
    
    const success = startThermostat(config);
    
    if (!success) {
      const lastError = getLastError();
      return res.status(500).json({ 
        error: lastError || 'Error al iniciar el termostato' 
      });
    }
    
    // Invalidar caché de estado
    lastStateETag = '';
    
    res.status(200).json({ status: 'started', config });
  } catch (error) {
    console.error('Error en endpoint /thermostat/start:', error);
    res.status(500).json({ error: 'Error al iniciar el termostato' });
  }
});

// Detener termostato
router.post('/thermostat/stop', (_req: Request, res: Response) => {
  try {
    const success = stopThermostat();
    
    if (!success) {
      const lastError = getLastError();
      return res.status(500).json({ 
        error: lastError || 'Error al detener el termostato' 
      });
    }
    
    // Invalidar caché de estado
    lastStateETag = '';
    
    res.status(200).json({ status: 'stopped' });
  } catch (error) {
    console.error('Error en endpoint /thermostat/stop:', error);
    res.status(500).json({ error: 'Error al detener el termostato' });
  }
});

// Reiniciar el termostato (útil cuando ocurren errores)
router.post('/thermostat/reset', (_req: Request, res: Response) => {
  try {
    const success = resetThermostat();
    
    if (!success) {
      const lastError = getLastError();
      return res.status(500).json({ 
        error: lastError || 'Error al reiniciar el termostato' 
      });
    }
    
    // Invalidar caché de estado
    lastStateETag = '';
    
    const state = getThermostatState();
    
    res.status(200).json({ 
      status: 'reset', 
      running: state.isRunning,
      targetTemperature: state.targetTemperature,
      hysteresis: state.hysteresis
    });
  } catch (error) {
    console.error('Error en endpoint /thermostat/reset:', error);
    res.status(500).json({ error: 'Error al reiniciar el termostato' });
  }
});

// === Rutas para gestión MQTT ===

// Obtener el estado del servicio MQTT
router.get('/mqtt/status', (_req: Request, res: Response) => {
  try {
    const mqttState = getMqttServiceState();
    res.json({
      status: 'ok',
      mqtt: {
        isConnected: mqttState.isConnected,
        isEnabled: mqttState.isEnabled,
        isHealthy: isMqttHealthy(),
        lastPublishTime: mqttState.lastPublishTime,
        lastError: mqttState.lastError,
        reconnectAttempts: mqttState.reconnectAttempts,
        config: {
          brokerUrl: mqttState.config.brokerUrl,
          clientId: mqttState.config.clientId,
          publishInterval: mqttState.config.publishInterval,
          topics: mqttState.config.topics
        }
      }
    });
  } catch (error) {
    console.error('Error al obtener estado MQTT:', error);
    res.status(500).json({ 
      error: 'Error al obtener el estado del servicio MQTT',
      mqtt: {
        isConnected: false,
        isEnabled: false,
        isHealthy: false
      }
    });
  }
});

// Reiniciar el servicio MQTT
router.post('/mqtt/restart', (_req: Request, res: Response) => {
  try {
    console.log('🔄 Solicitud de reinicio del servicio MQTT via API');
    restartMqtt();
    res.json({ 
      message: 'Servicio MQTT reiniciando...',
      status: 'restarting'
    });
  } catch (error) {
    console.error('Error al reiniciar servicio MQTT:', error);
    res.status(500).json({ 
      error: 'Error al reiniciar el servicio MQTT'
    });
  }
});

export default router;