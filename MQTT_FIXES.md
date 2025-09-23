# Correcciones MQTT para Home Assistant

## Problemas identificados y solucionados

### 1. **Plantillas incorrectas en Home Assistant**
**Problema**: Las plantillas Jinja2 no comparaban correctamente los valores booleanos.
**Solución**: Cambiado de `{% if value_json.value %}` a `{% if value_json.value == true %}`

### 2. **Topic de availability inexistente**
**Problema**: La configuración usaba `termostato/status/online` que no existía en el backend.
**Solución**: 
- Agregado topic `online` a la configuración del backend
- Implementado publicación de estado online/offline
- Agregado Last Will Testament para estado offline automático

### 3. **Compatibilidad de desarrollo**
**Problema**: El código de hardware (pigpio, DS18B20) solo funciona en Raspberry Pi.
**Solución**: 
- Implementado modo mock para desarrollo en Windows/otros sistemas
- Detección automática del entorno (Raspberry Pi vs desarrollo)
- Fallback a mock si falla la inicialización del hardware

## Cambios realizados

### Backend (`src/services/mqtt.ts`)
- ✅ Agregado topic `online` a la configuración
- ✅ Publicación de estado online al conectar
- ✅ Publicación de estado offline al desconectar
- ✅ Last Will Testament para desconexión inesperada

### Hardware (`src/hardware/`)
- ✅ Modo mock para relay.ts en desarrollo
- ✅ Modo mock para sensor.ts en desarrollo
- ✅ Detección automática del entorno
- ✅ Temperaturas simuladas realistas (18-25°C)

### Home Assistant Configuration
- ✅ Corregidas plantillas Jinja2 para comparaciones booleanas
- ✅ Agregado availability_topic donde corresponde
- ✅ Simplificadas configuraciones payload_on/payload_off
- ✅ Eliminadas configuraciones inválidas (broker, port en entidades)

## Configuración de Home Assistant corregida

### Cambios principales:
1. **Climate entity**: Plantillas corregidas para mode_state_template
2. **Binary sensors**: payload_on/off como booleanos, no strings
3. **Availability**: Agregado donde faltaba, removido topic inexistente
4. **Switch**: Simplificada configuración state_on/state_off

### Formato de mensajes MQTT
Todos los mensajes siguen el formato:
```json
{
  "value": <valor>,
  "timestamp": "<ISO_timestamp>"
}
```

## Testing

### Verificar comunicación MQTT:
1. Backend publica en topics: `termostato/status/*`
2. Home Assistant debe mostrar mensajes en Developer Tools > MQTT
3. Entidades deben actualizarse automáticamente

### Verificar entidades:
- `climate.termostato_inteligente` - Control principal
- `sensor.temperatura_actual_termostato` - Temperatura actual
- `sensor.setpoint_termostato` - Temperatura objetivo
- `binary_sensor.calefaccion_activa` - Estado del relé
- `switch.control_manual_calefaccion` - Control manual

## Próximos pasos

1. **Instalar Mosquitto** localmente para testing completo
2. **Verificar plantillas** en Home Assistant Developer Tools
3. **Probar control bidireccional** (HA → Backend y Backend → HA)
4. **Documentar configuración** de Mosquitto en Raspberry Pi
