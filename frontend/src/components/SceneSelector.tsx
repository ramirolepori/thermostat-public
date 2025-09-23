import React, { useState, useEffect, useCallback, useMemo } from "react"
import { Trash2 } from "lucide-react"
import "../styles/Thermostat.css"
import { validateSceneName, validateTemperatureValue } from "../api/validation";
import { useApiRequest } from "../api/useApiRequest";

interface Scene {
  _id: string; // MongoDB ID
  name: string;
  temperature: number;
  active: boolean;
}

interface SceneSelectorProps {
  scenes: Scene[];
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (name: string, temperature: number) => void;
  disabled: boolean;
}

// Usar React.memo para evitar renderizados innecesarios
const SceneSelector: React.FC<SceneSelectorProps> = React.memo(({ scenes, onActivate, onDelete, onAdd, disabled }) => {
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [longPressTimer, setLongPressTimer] = useState<number | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  // Lógica para crear escena
  const [showNewScene, setShowNewScene] = useState(false)
  const [newSceneName, setNewSceneName] = useState("")
  const [newSceneTemp, setNewSceneTemp] = useState(22)
  const [formError, setFormError] = useState<string | null>(null)

  // Usar useApiRequest para crear escena
  const [createSceneRequest, { loading: creatingScene, error: createSceneError }] = useApiRequest(async (name: string, temp: number) => {
    // Simula llamada a backend o usa createScene si está disponible
    return onAdd(name, temp);
  });

  // Detect if we're on a mobile device - optimizado con useCallback
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }

    checkMobile()
    // Usar un debounce para resize para evitar múltiples rerenderizados
    let resizeTimer: number | null = null;
    const handleResize = () => {
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(checkMobile, 100);
    };

    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
    }
  }, [])

  // Close context menu when clicking outside - optimizado con useCallback
  useEffect(() => {
    // Solo agregar event listeners si el menú contextual está abierto
    if (!contextMenu) return;
    
    const handleClickOutside = () => {
      setContextMenu(null)
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("touchstart", handleClickOutside)

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("touchstart", handleClickOutside)
    }
  }, [contextMenu])

  // Handle delete with confirmation - optimizado con useCallback
  const handleDelete = useCallback((e: React.MouseEvent, sceneId: string) => {
    e.stopPropagation() // Prevent activating the scene when clicking delete
    onDelete(sceneId)
    setContextMenu(null)
  }, [onDelete])

  // Handle long press for mobile - optimizado con useCallback
  const handleTouchStart = useCallback((e: React.TouchEvent, sceneId: string) => {
    if (disabled) return

    const timer = window.setTimeout(() => {
      const touch = e.touches[0]
      const rect = e.currentTarget.getBoundingClientRect()
      setContextMenu({
        id: sceneId,
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      })
    }, 500) // 500ms long press

    setLongPressTimer(timer)
  }, [disabled])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }, [longPressTimer])

  const handleTouchMove = useCallback(() => {
    // Cancel long press if user moves finger
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }, [longPressTimer])

  // Handler para agregar nueva escena con validación centralizada y accesibilidad
  const handleAddScene = useCallback(async () => {
    const nameError = validateSceneName(newSceneName.trim());
    const tempError = validateTemperatureValue(newSceneTemp);
    if (nameError) {
      setFormError(nameError);
      return;
    }
    if (tempError) {
      setFormError(tempError);
      return;
    }
    if (scenes.some(scene => scene.name.toLowerCase() === newSceneName.trim().toLowerCase())) {
      setFormError("Ya existe una escena con este nombre");
      return;
    }
    try {
      await createSceneRequest(newSceneName.trim(), newSceneTemp);
      setShowNewScene(false);
      setNewSceneName("");
      setNewSceneTemp(22);
      setFormError(null);
    } catch (e: any) {
      setFormError(e?.message || "Error al crear la escena");
    }
  }, [onAdd, newSceneName, newSceneTemp, scenes, createSceneRequest]);

  // Memoizar la lista de escenas para evitar recálculo
  const scenesList = useMemo(() => (
    <div className="scenes-list">
      {scenes.map((scene) => (
        <div
          key={scene._id}
          className="scene-wrapper"
          onTouchStart={(e) => isMobile && handleTouchStart(e, scene._id)}
          onTouchEnd={isMobile ? handleTouchEnd : undefined}
          onTouchMove={isMobile ? handleTouchMove : undefined}
        >
          <button
            className={`scene-button ${scene.active ? "active-scene" : ""}`}
            onClick={() => !disabled && onActivate(scene._id)}
            disabled={disabled}
          >
            <span className="scene-name">{scene.name}</span>
            <span className="scene-temp">{scene.temperature}°C</span>
          </button>

          {/* Desktop delete button (visible on hover) */}
          {!isMobile && (
            <button
              className="delete-scene-button"
              onClick={(e) => handleDelete(e, scene._id)}
              disabled={disabled}
              aria-label={`Delete ${scene.name} scene`}
            >
              <Trash2 size={16} />
            </button>
          )}

          {/* Context menu for mobile */}
          {contextMenu && contextMenu.id === scene._id && (
            <div
              className="context-menu"
              style={{
                top: `${contextMenu.y}px`,
                left: `${contextMenu.x}px`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="context-menu-item delete-option" onClick={(e) => handleDelete(e, scene._id)}>
                <Trash2 size={16} />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      ))}
      {/* Botón para agregar nueva escena y formulario */}
      <div className="scene-wrapper add-scene-wrapper">
        {showNewScene ? (
          <div className="add-scene-form">
            <input
              type="text"
              placeholder="Nombre de la escena"
              value={newSceneName}
              onChange={e => { setNewSceneName(e.target.value); setFormError(null); }}
              disabled={disabled}
              maxLength={32}
              aria-label="Nombre de la escena"
              aria-invalid={!!formError}
              aria-describedby={formError ? "scene-form-error" : undefined}
              style={{ marginRight: 8 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', marginRight: 8 }}>
              <input
                type="range"
                min={10}
                max={35}
                value={newSceneTemp}
                onChange={e => setNewSceneTemp(Number(e.target.value))}
                disabled={disabled}
                aria-label="Temperatura de la escena"
                style={{ marginRight: 8 }}
              />
              <span>{newSceneTemp}°C</span>
            </div>
            <button
              className="scene-button"
              onClick={handleAddScene}
              disabled={disabled || !newSceneName.trim() || creatingScene}
              aria-busy={creatingScene}
            >
              {creatingScene ? "Guardando..." : "Guardar"}
            </button>
            <button
              className="scene-button"
              style={{ marginLeft: 4 }}
              onClick={() => { setShowNewScene(false); setFormError(null); }}
              disabled={disabled}
            >
              Cancelar
            </button>
            {formError && <div id="scene-form-error" className="scene-form-error" role="alert">{formError}</div>}
            {createSceneError && !formError && (
              <div className="scene-form-error" role="alert">{createSceneError}</div>
            )}
          </div>
        ) : (
          <button
            className="scene-button add-scene-btn"
            onClick={() => setShowNewScene(true)}
            disabled={disabled}
          >
            + Nueva escena
          </button>
        )}
      </div>
    </div>
  ), [scenes, isMobile, disabled, handleTouchStart, handleTouchEnd, handleTouchMove, handleDelete, contextMenu, onActivate, showNewScene, newSceneName, newSceneTemp, handleAddScene, formError, creatingScene, createSceneError])

  return scenesList;
});

export default React.memo(SceneSelector);
