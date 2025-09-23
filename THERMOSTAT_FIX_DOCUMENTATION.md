# Corrección del Estado del Termostato en Home Assistant

## Problema Identificado

El termostato se mostraba como "apagado" en la app Casa de iPhone cuando la caldera se apagaba, cuando en realidad el termostato debería permanecer "encendido" (modo heat) y solo cambiar el estado de calentamiento.

## Causa Raíz

En `homeassistant_configuration.yaml`, el `mode_state_template` mapeaba incorrectamente el estado del relé de la caldera directamente al modo del termostato:

```yaml
# CONFIGURACIÓN INCORRECTA
mode_state_template: >-
  {% if value_json.value == true %}
    heat
  {% else %}
    off
  {% endif %}
```

Esto causaba que:
- Caldera encendida = Termostato en modo "heat" ✅
- Caldera apagada = Termostato en modo "off" ❌ (INCORRECTO)

## Solución Implementada

### 1. Nueva Configuración de Home Assistant

Se creó `homeassistant_configuration_fixed.yaml` con los siguientes cambios principales:

#### a) Separación conceptual de termostato y caldera:
- **Termostato**: Controla el modo (heat/off) via `termostato/status/mode`
- **Caldera**: Muestra estado de calentamiento via `action_template`

#### b) Uso de `action_topic` para mostrar el estado real:
```yaml
action_topic: "termostato/status/relay"
action_template: >-
  {% if value_json.value == true %}
    heating
  {% else %}
    idle
  {% endif %}
```

#### c) Nuevo topic para control de modo:
```yaml
mode_command_topic: "termostato/mode/set"
mode_state_topic: "termostato/status/mode"
```

### 2. Actualización del Backend

#### a) Nuevos topics MQTT:
- `termostato/status/mode` - Estado del modo del termostato
- `termostato/mode/set` - Comando para cambiar modo

#### b) Nueva lógica de publicación:
- Publica modo "heat" cuando el termostato está funcionando
- Publica modo "off" cuando el termostato está detenido
- El estado del relé sigue siendo independiente

#### c) Nuevas funciones agregadas:
- `handleModeCommand()` - Maneja comandos de modo del termostato
- `publishModeUpdate()` - Publica actualizaciones de modo

## Comportamiento Correcto Esperado

Ahora en la app Casa verás:

### Cuando el termostato está encendido:
- **Modo**: Heat (siempre)
- **Estado**: "Heating" cuando la caldera está encendida / "Idle" cuando está apagada
- **Temperatura**: Muestra temperatura actual y setpoint

### Cuando el termostato está apagado:
- **Modo**: Off
- **Estado**: Idle
- **Caldera**: Apagada

## Archivos Modificados

1. **homeassistant_configuration.yaml** - Configuración corregida directamente
2. **backend/src/services/mqtt.ts** - Soporte para nuevo topic de modo
3. **backend/src/services/logic.ts** - Publicación de actualizaciones de modo

## Próximos Pasos

1. **La configuración ya está actualizada** en `homeassistant_configuration.yaml`

2. **Reiniciar servicios**:
   ```bash
   # Reiniciar backend
   cd backend
   npm run build
   pm2 restart ecosystem.config.js
   
   # Reiniciar Home Assistant (desde su interfaz web)
   ```

3. **Verificar en MQTT**: Monitorear que se publiquen los nuevos mensajes:
   ```bash
   mosquitto_sub -h localhost -t "termostato/status/mode"
   ```

4. **Probar en la app Casa**: Verificar que el termostato ahora mantenga el estado correcto.

## Notas Técnicas

- La separación termostato/caldera ahora es conceptualmente correcta
- El backend mantiene compatibilidad con configuraciones anteriores
- Los sensores adicionales siguen funcionando igual
- Se agregó un switch maestro para control completo del termostato