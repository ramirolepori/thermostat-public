import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  Thermometer,
  Power,
  Plus,
  Minus,
  Zap,
  Save,
  AlertTriangle,
  Info,
  LoaderCircle,
} from "lucide-react";
import SceneSelector from "./SceneSelector";
import "../styles/Thermostat.css";
import {
  getTemperature,
  getStatus,
  setTargetTemperature,
  getTargetTemperature,
  startThermostat,
  stopThermostat,
  checkBackendConnectivity,
  fetchScenes,
  createScene,
  deleteScene as deleteSceneApi,
} from "../api/thermostatBackend";

// Definición de la interfaz para las escenas
interface Scene {
  _id: string; // Usar el id de MongoDB
  name: string; // Nombre de la escena
  temperature: number; // Temperatura objetivo de la escena
  active: boolean; // Indica si la escena está activa
}

// Detectar navegador Safari
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// Constantes para optimizar el rendimiento
const POLLING_INTERVAL = 8000; // Incrementado a 8 segundos para reducir peticiones
const DEBOUNCE_INTERVAL = 500; // 500ms para debounce

const Thermostat: React.FC = () => {
  // Estados para manejar la lógica del termostato
  const [currentTemp, setCurrentTemp] = useState<number>(20);
  const [targetTemp, setTargetTemp] = useState<number>(22);
  const [isHeating, setIsHeating] = useState<boolean>(false);
  const [isPowerOn, setIsPowerOn] = useState<boolean>(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isTogglingPower, setIsTogglingPower] = useState<boolean>(false); // Nuevo estado
  const [error, setError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean>(true);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [showSafariWarning, setShowSafariWarning] = useState<boolean>(isSafari);

  // Referencias para gestionar polling y debounce
  const pollingInterval = useRef<number | null>(null);
  const updateInProgress = useRef<boolean>(false);
  const tempDebounceTimer = useRef<number | null>(null);

  // Memoria de los últimos datos para evitar renderizados innecesarios
  const lastDataTimestamp = useRef<number>(0);

  // Cargar escenas desde el backend al iniciar y cuando backendConnected cambie a true
  useEffect(() => {
    const loadScenes = async () => {
      try {
        const data = await fetchScenes();
        setScenes(data);
      } catch (e) {
        setScenes([]);
      }
    };
    if (backendConnected) {
      loadScenes();
    }
  }, [backendConnected]);

  // Función para actualizar datos del termostato con evitación de solicitudes duplicadas
  const updateThermostatData = useCallback(
    async (forceFetch: boolean = false) => {
      // Evitar actualizaciones concurrentes o innecesarias
      if (updateInProgress.current && !forceFetch) return;

      // Limitar la frecuencia de actualizaciones para no saturar la interfaz
      const now = Date.now();
      if (!forceFetch && now - lastDataTimestamp.current < 2000) return;

      updateInProgress.current = true;

      try {
        // Verificar conectividad del backend primero
        let isConnected = false;
        try {
          isConnected = await checkBackendConnectivity();
        } catch (connError) {
          console.error(
            "Error durante la verificación de conectividad:",
            connError
          );
          isConnected = false;
        }

        setBackendConnected(isConnected);

        if (!isConnected) {
          setError(
            "No se puede conectar al sistema del termostato. Intente nuevamente."
          );
          updateInProgress.current = false;
          return;
        }

        // Si el termostato está apagado y no es una actualización forzada, no buscar datos
        if (!isPowerOn && !forceFetch) {
          setError(null);
          updateInProgress.current = false;
          return;
        }

        // Obtener datos en paralelo cuando sea posible
        try {
          const [tempResponse, statusResponse] = await Promise.allSettled([
            getTemperature(),
            getStatus(),
          ]);

          // Procesar respuesta de temperatura
          if (
            tempResponse.status === "fulfilled" &&
            !isNaN(tempResponse.value)
          ) {
            setCurrentTemp((prev) => {
              // Solo actualizar si hay un cambio real (> 0.1)
              return Math.abs(prev - tempResponse.value) > 0.1
                ? tempResponse.value
                : prev;
            });
          }

          // Procesar respuesta de estado
          if (statusResponse.status === "fulfilled" && statusResponse.value) {
            const status = statusResponse.value;

            // Actualizar estado de calentamiento
            setIsHeating(status.isHeating || false);

            // Solo actualizar temperatura objetivo si es válida y ha cambiado
            if (status.targetTemperature && !isNaN(status.targetTemperature)) {
              setTargetTemp((prev) => {
                return Math.abs(prev - status.targetTemperature) > 0.1
                  ? status.targetTemperature
                  : prev;
              });
            }

            // Sincronizar el estado de encendido con el backend
            setIsPowerOn(status.isRunning);
          }

          // Actualizar timestamp del último dato recibido
          lastDataTimestamp.current = Date.now();

          // Limpiar error si todo fue exitoso
          setError(null);
        } catch (dataError) {
          console.error("Error obteniendo datos del termostato:", dataError);
          // Solo mostrar error en la UI para actualizaciones explícitamente solicitadas
          if (forceFetch) {
            setError(
              "Error al actualizar datos del termostato. Intente nuevamente."
            );
          }
        }
      } finally {
        updateInProgress.current = false;
      }
    },
    [isPowerOn]
  );

  // Cargar datos iniciales del backend
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Verificar conectividad del backend
        const isConnected = await checkBackendConnectivity();
        setBackendConnected(isConnected);

        if (!isConnected) {
          setError(
            "No se puede conectar al sistema del termostato. Revise la conexión del dispositivo."
          );
          setLoading(false);
          return;
        }

        // Obtener datos para la inicialización de la interfaz
        await updateThermostatData(true);
      } catch (error) {
        console.error("Error fetching initial data:", error);
        setError(
          "Error al conectar con el sistema del termostato. Usando valores predeterminados."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();

    // Configurar el intervalo de actualización de datos
    const setupPollingInterval = () => {
      // Limpiar cualquier intervalo existente
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }

      // Crear nuevo intervalo de polling (cada POLLING_INTERVAL ms)
      pollingInterval.current = window.setInterval(() => {
        // Solo hacer polling si la ventana está activa
        if (!document.hidden) {
          updateThermostatData();
        }
      }, POLLING_INTERVAL);
    };

    setupPollingInterval();

    // Event listener para pausar/reanudar polling cuando la pestaña cambia de estado
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Si la pestaña está inactiva, pausar el polling
        if (pollingInterval.current) {
          clearInterval(pollingInterval.current);
          pollingInterval.current = null;
        }
      } else {
        // Si la pestaña vuelve a estar activa, reanudar el polling
        setupPollingInterval();
        // Actualizar datos inmediatamente
        updateThermostatData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Limpieza al desmontar el componente
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }

      if (tempDebounceTimer.current) {
        clearTimeout(tempDebounceTimer.current);
        tempDebounceTimer.current = null;
      }
    };
  }, [updateThermostatData]);

  // Reintentar conexión al backend
  const handleRetryConnection = useCallback(async () => {
    setLoading(true);
    setRetryCount((prev) => prev + 1);
    await updateThermostatData(true);
    setLoading(false);
  }, [updateThermostatData]);

  // Función compartida para cambiar temperatura con debounce
  const changeTemperature = useCallback(async (newTemp: number) => {
    // Actualizar UI inmediatamente para respuesta instantánea
    setTargetTemp(newTemp);

    // Cancelar timer de debounce anterior si existe
    if (tempDebounceTimer.current) {
      clearTimeout(tempDebounceTimer.current);
    }

    // Configurar nuevo timer de debounce (DEBOUNCE_INTERVAL ms)
    tempDebounceTimer.current = window.setTimeout(async () => {
      try {
        const success = await setTargetTemperature(newTemp);
        if (!success) {
          throw new Error("Error al establecer temperatura objetivo");
        }
        // Limpiar error si la operación tuvo éxito
        setError(null);
      } catch (error) {
        console.error("Error setting target temperature:", error);
        setError("Error al establecer la temperatura objetivo");
      }
    }, DEBOUNCE_INTERVAL);
  }, []);

  // Incrementa la temperatura objetivo
  const increaseTemp = useCallback(() => {
    if (targetTemp >= 30) return;
    const newTemp = targetTemp + 0.5;
    changeTemperature(newTemp);
  }, [targetTemp, changeTemperature]);

  // Reduce la temperatura objetivo
  const decreaseTemp = useCallback(() => {
    if (targetTemp <= 15) return;
    const newTemp = targetTemp - 0.5;
    changeTemperature(newTemp);
  }, [targetTemp, changeTemperature]);

  // Alterna el estado de encendido/apagado del termostato
  const togglePower = useCallback(async () => {
    setIsTogglingPower(true); // Activar spinner solo para el botón
    try {
      const newPowerState = !isPowerOn;
      setIsPowerOn(newPowerState);
      let success;
      if (newPowerState) {
        success = await startThermostat(targetTemp);
      } else {
        success = await stopThermostat();
      }
      if (!success) {
        throw new Error(
          `Error al ${newPowerState ? "iniciar" : "detener"} el termostato`
        );
      }
      if (newPowerState) {
        await updateThermostatData(true);
      }
      setError(null);
    } catch (error) {
      console.error("Error toggling power:", error);
      setError(`Error al ${isPowerOn ? "apagar" : "encender"} el termostato`);
      setIsPowerOn(!isPowerOn);
    } finally {
      setIsTogglingPower(false); // Desactivar spinner
    }
  }, [isPowerOn, targetTemp, updateThermostatData]);

  // Activa una escena seleccionada
  const activateScene = useCallback(
    async (sceneId: string) => {
      const selectedScene = scenes.find((scene) => scene._id === sceneId);
      if (!selectedScene) return;

      // Actualizar UI primero (optimismo UI)
      const updatedScenes = scenes.map((scene) => ({
        ...scene,
        active: scene._id === sceneId,
      }));
      setScenes(updatedScenes);

      try {
        // Establecer la temperatura de la escena seleccionada
        const success = await setTargetTemperature(selectedScene.temperature);
        if (!success) {
          throw new Error("Error al establecer temperatura de escena");
        }

        // Actualizar temperatura objetivo en la UI
        setTargetTemp(selectedScene.temperature);
        setError(null);
      } catch (error) {
        console.error("Error activating scene:", error);
        setError("Error al activar la escena");
        // Revertir el cambio de estado de las escenas
        setScenes(scenes);
      }
    },
    [scenes]
  );

  // Elimina una escena de la lista
  const deleteScene = useCallback(
    async (sceneId: string) => {
      try {
        await deleteSceneApi(sceneId);
        setScenes((prevScenes) =>
          prevScenes.filter((scene) => scene._id !== sceneId)
        );
      } catch (e: any) {
        setError(e.message || "Error al eliminar la escena");
      }
    },
    []
  );

  // Nueva función para agregar escena desde SceneSelector
  const handleAddScene = useCallback(
    async (name: string, temperature: number) => {
      try {
        // Validar si ya existe una escena con el mismo nombre
        if (
          scenes.some(
            (scene) => scene.name.toLowerCase() === name.trim().toLowerCase()
          )
        ) {
          setError("Ya existe una escena con este nombre");
          return;
        }
        const newScene = await createScene(name, temperature, false);
        setScenes((prev) => [...prev, newScene as Scene]);
        setError(null);
      } catch (e: any) {
        setError(e.message || "Error al crear la escena");
      }
    },
    [scenes]
  );

  // Componente de error memoizado para evitar re-renderizados innecesarios
  const ErrorBanner = useMemo(() => {
    if (!error) return null;
    return (
      <div className="error-banner">
        <AlertTriangle size={16} />
        <span>{error}</span>
        <button onClick={() => setError(null)}>×</button>
      </div>
    );
  }, [error]);

  // Advertencia de Safari
  const SafariWarning = useMemo(() => {
    if (!showSafariWarning) return null;
    return (
      <div className="safari-warning">
        <Info size={16} />
        <span>
          Si experimentas problemas de conexión en Safari, prueba a usar Chrome
          o Firefox para una mejor experiencia.
        </span>
        <button onClick={() => setShowSafariWarning(false)}>×</button>
      </div>
    );
  }, [showSafariWarning]);

  // Memoizar componente de temperatura para evitar re-renderizados
  const TemperatureControls = useMemo(
    () => (
      <div className="temperature-display">
        <div className="current-temp">
          <Thermometer className="temp-icon" />
          <span>
            {currentTemp !== null && !isNaN(currentTemp)
              ? currentTemp.toFixed(1)
              : "--"}
            °C
          </span>
          {isHeating && <Zap className="heating-icon" />}
        </div>

        <div className={`target-temp ${!isPowerOn ? "disabled" : ""}`}>
          <button
            className="temp-button decrease"
            onClick={decreaseTemp}
            disabled={!isPowerOn}
            aria-label="Decrease temperature"
          >
            <Minus size={20} />
          </button>

          <span>
            {targetTemp !== null && !isNaN(targetTemp)
              ? targetTemp.toFixed(1)
              : "--"}
            °C
          </span>

          <button
            className="temp-button increase"
            onClick={increaseTemp}
            disabled={!isPowerOn}
            aria-label="Increase temperature"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>
    ),
    [currentTemp, targetTemp, isHeating, isPowerOn, decreaseTemp, increaseTemp]
  );

  // Renderizar pantalla de error de conexión
  if (!backendConnected) {
    return (
      <div className="thermostat-container">
        <div className="thermostat-error">
          <AlertTriangle size={32} />
          <h2>Error de conexión</h2>
          <p>No se puede conectar al sistema del termostato.</p>
          <p>
            Verifique que el dispositivo esté encendido y conectado a la red.
          </p>
          {isSafari && (
            <p className="safari-note">
              <strong>Nota:</strong> Los navegadores Safari pueden tener
              problemas de conectividad. Si es posible, intente con Chrome o
              Firefox.
            </p>
          )}
          <button className="retry-button" onClick={handleRetryConnection}>
            Reintentar conexión
          </button>
        </div>
      </div>
    );
  }

  // Renderizar interfaz principal del termostato
  return (
    <div className="thermostat-container">
      {/* Mostrar banda de error si existe */}
      {ErrorBanner}

      {/* Mostrar advertencia de Safari si corresponde */}
      {SafariWarning}

      <div className="thermostat">
        {/* Controles principales del termostato */}
        <div className="main-control">
          {loading ? (
            <button
              className={`power-button ${isPowerOn ? "power-on" : "power-off"}`}
              aria-label="Loading..."
            >
              <LoaderCircle className="spinner" size={24} />
            </button>
          ) : isTogglingPower ? (
            <button
              className={`power-button ${isPowerOn ? "power-on" : "power-off"}`}
              aria-label="Toggling power..."
            >
              <LoaderCircle className="spinner" size={24} />
            </button>
          ) : (
            <button
              className={`power-button ${isPowerOn ? "power-on" : "power-off"}`}
              onClick={togglePower}
              aria-label="Power"
            >
              <Power size={24} />
            </button>
          )}
          {TemperatureControls}
        </div>

        {/* Sección de escenas */}
        <div className="scenes-section">
          <h2>Scenes</h2>
          <SceneSelector
            scenes={scenes}
            onActivate={activateScene}
            onDelete={deleteScene}
            onAdd={handleAddScene}
            disabled={!isPowerOn}
          />
        </div>
      </div>
    </div>
  );
};

// Usar React.memo para evitar renderizados innecesarios del componente
export default React.memo(Thermostat);
