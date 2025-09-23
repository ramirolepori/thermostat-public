// src/api/thermostatBackend.ts

// Interfaces de respuesta
interface TemperatureResponse {
  temperature: number;
  fromCache?: boolean;
}

interface StatusResponse {
  currentTemperature: number;
  targetTemperature: number;
  hysteresis: number;
  isHeating: boolean;
  lastUpdated: Date;
  isRunning: boolean;
  lastError: string | null;
}

interface TargetTemperatureResponse {
  target: number;
}

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  thermostatRunning: boolean;
  lastError: string | null;
  timestamp: string;
}

// Configuración de API base
const API_BASE_URL = '/api';
let isBackendAvailable = true;
let backendCheckInProgress = false;
let lastBackendCheckTime = 0;
const BACKEND_CHECK_INTERVAL = 60000; // Aumentado a 60 segundos para reducir peticiones de comprobación
const BACKEND_CHECK_TIMEOUT = 3000; // Reducido a 3 segundos para acelerar los timeouts

// Headers comunes
const jsonHeaders = {
  'Content-Type': 'application/json',
};

// Verificar compatibilidad del navegador con características modernas
const checkForSafariIssues = () => {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) {
    console.info('Detectado Safari: activando opciones de compatibilidad');
  }
  return {
    isSafari,
    hasWorkingAbortController: typeof AbortController === 'function'
  };
};

const browserCapabilities = checkForSafariIssues();

// Función para crear un timeout que funcione en todos los navegadores
function createSafeTimeout(ms: number): { 
  promise: Promise<never>; 
  clear: () => void 
} {
  let timeoutId: number | null = null;
  
  const promise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('Request timeout'));
    }, ms);
  });
  
  return {
    promise,
    clear: () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
  };
}

// Función para verificar si el backend está disponible
async function checkBackendAvailability(): Promise<boolean> {
  // Evitar comprobaciones si otra ya está en progreso
  if (backendCheckInProgress) return isBackendAvailable;
  
  // Evitar comprobaciones frecuentes usando cache
  const now = Date.now();
  if (now - lastBackendCheckTime < BACKEND_CHECK_INTERVAL && isBackendAvailable) return isBackendAvailable;
  
  try {
    backendCheckInProgress = true;
    
    // Usar endpoint de health check para verificar disponibilidad
    const timeout = createSafeTimeout(BACKEND_CHECK_TIMEOUT);
    const controller = new AbortController();
    
    try {
      const fetchPromise = fetch(`${API_BASE_URL}/health`, { 
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
      
      const res = await Promise.race([
        fetchPromise,
        timeout.promise.catch(error => {
          controller.abort();
          throw error;
        })
      ]);
      
      timeout.clear();
      
      if (!res.ok) throw new Error(`Backend responded with status: ${res.status}`);
      
      // Verificar que la respuesta es JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Backend responded with non-JSON content');
      }
      
      // Opcional: verificar estado del sistema
      const healthData: HealthResponse = await res.json();
      if (healthData.status !== 'ok') {
        console.warn('Backend health check returned non-OK status:', healthData.status);
        console.warn('Last error reported by backend:', healthData.lastError);
      }
      
      isBackendAvailable = true;
    } catch (error) {
      timeout.clear();
      throw error;
    }
  } catch (error) {
    console.error('Backend availability check failed:', error);
    isBackendAvailable = false;
  } finally {
    backendCheckInProgress = false;
    lastBackendCheckTime = Date.now();
  }
  
  return isBackendAvailable;
}

// Función base para realizar peticiones fetch con manejo de errores mejorado
async function fetchWithErrorHandling<T>(
  endpoint: string, 
  options: RequestInit = {},
  defaultValue?: T
): Promise<T> {
  // Verificar disponibilidad del backend (sólo una vez por intervalo)
  if (!await checkBackendAvailability()) {
    console.warn(`Skipping request to ${endpoint} - backend unavailable`);
    throw new Error('Backend service unavailable');
  }
  
  // Configuración por defecto
  const fetchOptions: RequestInit = {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...jsonHeaders,
      ...(options.headers || {})
    },
    // Aseguramos que cache sea 'no-store' para que no haya problemas de caché en Safari
    cache: 'no-store'
  };
  
  let fetchPromise: Promise<Response>;
  let timeoutHandler;
  let clearTimeoutFn: (() => void) | null = null;
  
  // Elegir la estrategia de timeout basada en la compatibilidad del navegador
  if (browserCapabilities.hasWorkingAbortController && !options.signal) {
    // Usar AbortController si está disponible y no hay una señal ya configurada
    const controller = new AbortController();
    const timeout = createSafeTimeout(5000);
    clearTimeoutFn = timeout.clear;
    
    // Asignar la señal del controlador
    fetchOptions.signal = controller.signal;
    
    // Crear la promesa de fetch
    fetchPromise = fetch(`${API_BASE_URL}${endpoint}`, fetchOptions);
    
    // Race entre el fetch y el timeout
    timeoutHandler = Promise.race([
      fetchPromise,
      timeout.promise.catch(error => {
        controller.abort();
        throw error;
      })
    ]);
  } else {
    // Enfoque alternativo para navegadores sin soporte completo
    const timeout = createSafeTimeout(5000);
    clearTimeoutFn = timeout.clear;
    
    // Crear la promesa de fetch
    fetchPromise = fetch(`${API_BASE_URL}${endpoint}`, fetchOptions);
    
    // Race entre el fetch y el timeout
    timeoutHandler = Promise.race([
      fetchPromise,
      timeout.promise
    ]);
  }
  
  try {
    const response = await timeoutHandler;
    
    // Limpiar el timeout
    if (clearTimeoutFn) clearTimeoutFn();
    
    if (!response.ok) {
      // Intentar leer el mensaje de error del backend
      let errorMessage = `API error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.error) {
          errorMessage = errorData.error;
        }
      } catch (e) {
        // Si no se puede leer el JSON, usar el mensaje por defecto
      }
      
      throw new Error(errorMessage);
    }
    
    // Verificar que es JSON antes de intentar parsearlo
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`Invalid Content-Type: ${contentType} for endpoint ${endpoint}`);
      throw new Error('Invalid response format: expected JSON');
    }
    
    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    // Limpiar el timeout en caso de error
    if (clearTimeoutFn) clearTimeoutFn();
    
    // Mejorar los mensajes de error para errores de red
    let errorMessage = error.message || 'Unknown error';
    
    if (error.name === 'AbortError') {
      errorMessage = 'Request timeout - the server took too long to respond';
    } else if (errorMessage.includes('NetworkError') || errorMessage.includes('network')) {
      errorMessage = 'Network connection error - check your internet connection';
    }
    
    // Mensajes especiales para Safari
    if (browserCapabilities.isSafari && (
        errorMessage.includes('Failed to fetch') || 
        errorMessage.includes('NetworkError')
    )) {
      errorMessage = 'Connection error - Safari may be blocking the request. Check your connection or try another browser.';
    }
    
    console.error(`Error in ${endpoint}:`, errorMessage);
    
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(errorMessage);
  }
}

// Comprobar estado de salud del backend
export async function checkHealthStatus(): Promise<HealthResponse | null> {
  try {
    const data = await fetchWithErrorHandling<HealthResponse>(
      '/health',
      {},
      undefined
    );
    return data;
  } catch (error) {
    console.error('checkHealthStatus failed:', error);
    return null;
  }
}

// Obtener la temperatura actual desde el backend
export async function getTemperature(): Promise<number> {
  try {
    const data = await fetchWithErrorHandling<TemperatureResponse>(
      '/temperature',
      {},
      { temperature: NaN }
    );
    return data.temperature;
  } catch (error) {
    console.error('getTemperature failed:', error);
    return NaN;
  }
}

// Obtener el estado del termostato
export async function getStatus(): Promise<StatusResponse | null> {
  try {
    const defaultStatus: StatusResponse = { 
      currentTemperature: NaN, 
      targetTemperature: NaN, 
      hysteresis: NaN, 
      isHeating: false, 
      lastUpdated: new Date(), 
      isRunning: false,
      lastError: null
    };
    
    const data = await fetchWithErrorHandling<StatusResponse>('/status', {}, defaultStatus);
    
    // Asegurarse de que lastUpdated sea una instancia de Date
    return {
      ...data,
      lastUpdated: new Date(data.lastUpdated || Date.now())
    };
  } catch (error) {
    console.error('getStatus failed:', error);
    return null;
  }
}

// Setear temperatura objetivo
export async function setTargetTemperature(target: number): Promise<boolean> {
  try {
    await fetchWithErrorHandling('/target-temperature', {
      method: 'POST',
      body: JSON.stringify({ temperature: target }),
    });
    return true;
  } catch (error) {
    console.error('setTargetTemperature failed:', error);
    return false;
  }
}

// Obtener temperatura objetivo
export async function getTargetTemperature(): Promise<number | undefined> {
  try {
    const data = await fetchWithErrorHandling<TargetTemperatureResponse>(
      '/target-temperature',
      {},
      { target: NaN }
    );
    return data.target;
  } catch (error) {
    console.error('getTargetTemperature failed:', error);
    return undefined;
  }
}

// Iniciar termostato
export async function startThermostat(targetTemperature?: number, hysteresis?: number): Promise<boolean> {
  try {
    const bodyContent = JSON.stringify({ 
      targetTemperature: targetTemperature, 
      hysteresis: hysteresis 
    });
    
    // Usar un enfoque más compatible para diferentes navegadores
    try {
      await fetchWithErrorHandling('/thermostat/start', {
        method: 'POST',
        body: bodyContent,
      });
    } catch (error) {
      // Detectar error de método no permitido (405)
      const errorMsg = String(error);
      if (errorMsg.includes('405') || errorMsg.includes('Method Not Allowed')) {
        // Intentar con método PUT si POST falla con 405
        console.warn('POST method not allowed for thermostat/start, attempting PUT');
        await fetchWithErrorHandling('/thermostat/start', {
          method: 'PUT',
          body: bodyContent,
        });
      } else {
        throw error;
      }
    }
    return true;
  } catch (error) {
    console.error('startThermostat failed:', error);
    return false;
  }
}

// Detiene el termostato
export async function stopThermostat(): Promise<boolean> {
  try {
    await fetchWithErrorHandling('/thermostat/stop', {
      method: 'POST',
    });
    return true;
  } catch (error) {
    console.error('stopThermostat failed:', error);
    return false;
  }
}

// Reinicia el termostato en caso de errores
export async function resetThermostat(): Promise<boolean> {
  try {
    await fetchWithErrorHandling('/thermostat/reset', {
      method: 'POST',
    });
    return true;
  } catch (error) {
    console.error('resetThermostat failed:', error);
    return false;
  }
}

// Verificar conectividad del backend (utilidad pública)
export async function checkBackendConnectivity(): Promise<boolean> {
  return await checkBackendAvailability();
}

// --- SCENES API ---

// Obtener todas las escenas
export async function fetchScenes() {
  return fetchWithErrorHandling('/scenes', { method: 'GET' }, []);
}

// Crear una nueva escena
export async function createScene(name: string, temperature: number, active: boolean = false) {
  return fetchWithErrorHandling('/scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, temperature, active })
  });
}

// Eliminar una escena por ID
export async function deleteScene(id: string) {
  return fetchWithErrorHandling(`/scenes/${id}`, { method: 'DELETE' });
}
