# Integración MQTT - Termostato Inteligente

## Descripción

Este módulo integra el termostato inteligente con **Home Assistant** usando el protocolo MQTT. Permite control bidireccional y monitoreo del estado del termostato.

## Configuración

### Variables de Entorno

```bash
# URL del broker MQTT
MQTT_BROKER_URL=mqtt://localhost:1883

# ID del cliente MQTT (opcional, se genera automáticamente)
MQTT_CLIENT_ID=termostato_backend
```

### Broker MQTT

El sistema está configurado para conectarse a un broker **Mosquitto** ejecutándose en la misma Raspberry Pi (`mqtt://localhost:1883`).

## Topics MQTT

### Topics de Estado (Publicación)

El termostato publica periódicamente estos topics cada 10 segundos:

| Topic | Payload | Descripción |
|-------|---------|-------------|
| `termostato/status/temperature` | `{"value": 23.5, "timestamp": "2025-01-23T10:30:00.000Z"}` | Temperatura actual en °C |
| `termostato/status/relay` | `{"value": true, "timestamp": "2025-01-23T10:30:00.000Z"}` | Estado del relé (true = encendido) |
| `termostato/status/setpoint` | `{"value": 22.0, "timestamp": "2025-01-23T10:30:00.000Z"}` | Temperatura objetivo en °C |
| `termostato/status/online` | `{"value": true, "timestamp": "2025-01-23T10:30:00.000Z"}` | Estado de conexión del termostato |

### Topics de Comando (Suscripción)

Home Assistant puede enviar comandos a estos topics:

| Topic | Payload Esperado | Descripción |
|-------|------------------|-------------|
| `termostato/setpoint/set` | `{"value": 24.0}` | Cambiar temperatura objetivo |
| `termostato/relay/set` | `{"value": true}` | Control manual del relé |

## Integración con Home Assistant

### Configuración Completa para configuration.yaml

Agrega esta configuración a tu `configuration.yaml` existente:

```yaml
# Loads default set of integrations. Do not remove.
default_config:

# Load frontend themes from the themes folder
frontend:
  themes: !include_dir_merge_named themes

automation: !include automations.yaml
script: !include scripts.yaml
scene: !include scenes.yaml

# === CONFIGURACIÓN MQTT TERMOSTATO ===
mqtt:
  broker: localhost
  port: 1883
  discovery: true
  
  # Entidad Climate principal del termostato
  climate:
    - name: "Termostato Inteligente"
      unique_id: "termostato_inteligente"
      temperature_command_topic: "termostato/setpoint/set"
      temperature_state_topic: "termostato/status/setpoint"
      current_temperature_topic: "termostato/status/temperature"
      availability_topic: "termostato/status/online"
      payload_available: '{"value": true}'
      payload_not_available: '{"value": false}'
      value_template: "{{ value_json.value }}"
      current_temperature_template: "{{ value_json.value }}"
      temperature_command_template: '{"value": {{ value }}}'
      min_temp: 5
      max_temp: 30
      temp_step: 0.5
      modes:
        - "off"
        - "heat"
      mode_command_topic: "termostato/relay/set"
      mode_state_topic: "termostato/status/relay"
      mode_state_template: >
        {% if value_json.value %}
          heat
        {% else %}
          off
        {% endif %}
      mode_command_template: >
        {% if value == 'off' %}
          {"value": false}
        {% else %}
          {"value": true}
        {% endif %}
      # Configuración de precisión
      precision: 0.5
      # Configuración de timeout para evitar comandos duplicados
      send_if_off: true

  # Sensores adicionales del termostato
  sensor:
    - name: "Temperatura Actual Termostato"
      unique_id: "termostato_temperatura_actual"
      state_topic: "termostato/status/temperature"
      value_template: "{{ value_json.value }}"
      unit_of_measurement: "°C"
      device_class: "temperature"
      state_class: "measurement"
      availability_topic: "termostato/status/online"
      payload_available: '{"value": true}'
      payload_not_available: '{"value": false}'
      
    - name: "Setpoint Termostato"
      unique_id: "termostato_setpoint"
      state_topic: "termostato/status/setpoint"
      value_template: "{{ value_json.value }}"
      unit_of_measurement: "°C"
      device_class: "temperature"
      availability_topic: "termostato/status/online"
      payload_available: '{"value": true}'
      payload_not_available: '{"value": false}'
      
    - name: "Estado Relé Termostato"
      unique_id: "termostato_estado_rele"
      state_topic: "termostato/status/relay"
      value_template: "{{ 'Encendido' if value_json.value else 'Apagado' }}"
      icon: "mdi:power"
      availability_topic: "termostato/status/online"
      payload_available: '{"value": true}'
      payload_not_available: '{"value": false}'

  # Sensores binarios
  binary_sensor:
    - name: "Termostato Online"
      unique_id: "termostato_online"
      state_topic: "termostato/status/online"
      value_template: "{{ value_json.value }}"
      payload_on: "true"
      payload_off: "false"
      device_class: "connectivity"
      
    - name: "Calefacción Activa"
      unique_id: "termostato_calefaccion_activa"
      state_topic: "termostato/status/relay"
      value_template: "{{ value_json.value }}"
      payload_on: "true"
      payload_off: "false"
      device_class: "heat"
      availability_topic: "termostato/status/online"
      payload_available: '{"value": true}'
      payload_not_available: '{"value": false}'

  # Interruptores de control manual
  switch:
    - name: "Control Manual Calefacción"
      unique_id: "termostato_control_manual"
      state_topic: "termostato/status/relay"
      command_topic: "termostato/relay/set"
      state_on: '{"value": true}'
      state_off: '{"value": false}'
      payload_on: '{"value": true}'
      payload_off: '{"value": false}'
      value_template: "{{ value_json.value }}"
      icon: "mdi:radiator"
      availability_topic: "termostato/status/online"
      payload_available: '{"value": true}'
      payload_not_available: '{"value": false}'
```

### Configuración Alternativa Simplificada

Si prefieres una configuración más simple, puedes usar solo esto:

```yaml
# === CONFIGURACIÓN MQTT TERMOSTATO (SIMPLIFICADA) ===
mqtt:
  broker: localhost
  port: 1883
  
  climate:
    - name: "Termostato"
      temperature_command_topic: "termostato/setpoint/set"
      temperature_state_topic: "termostato/status/setpoint"
      current_temperature_topic: "termostato/status/temperature"
      value_template: "{{ value_json.value }}"
      temperature_command_template: '{"value": {{ value }}}'
      min_temp: 5
      max_temp: 30
      temp_step: 0.5
```

### Sensores Adicionales

```yaml
mqtt:
  sensor:
    - name: "Temperatura Actual"
      state_topic: "termostato/status/temperature"
      value_template: "{{ value_json.value }}"
      unit_of_measurement: "°C"
      device_class: "temperature"
      
    - name: "Estado Relé Termostato"
      state_topic: "termostato/status/relay"
      value_template: "{{ 'Encendido' if value_json.value else 'Apagado' }}"
      icon: "mdi:power"
      
  binary_sensor:
    - name: "Termostato Online"
      state_topic: "termostato/status/online"
      value_template: "{{ value_json.value }}"
      payload_on: "true"
      payload_off: "false"
      device_class: "connectivity"
```

## API REST para MQTT

### Obtener Estado del Servicio MQTT

```http
GET /api/mqtt/status
```

**Respuesta:**
```json
{
  "status": "ok",
  "mqtt": {
    "isConnected": true,
    "isEnabled": true,
    "isHealthy": true,
    "lastPublishTime": "2025-01-23T10:30:00.000Z",
    "lastError": null,
    "reconnectAttempts": 0,
    "config": {
      "brokerUrl": "mqtt://localhost:1883",
      "clientId": "termostato_backend",
      "publishInterval": 10000,
      "topics": {
        "temperature": "termostato/status/temperature",
        "relay": "termostato/status/relay",
        "setpoint": "termostato/status/setpoint",
        "setpointSet": "termostato/setpoint/set",
        "relaySet": "termostato/relay/set"
      }
    }
  }
}
```

### Reiniciar Servicio MQTT

```http
POST /api/mqtt/restart
```

**Respuesta:**
```json
{
  "message": "Servicio MQTT reiniciando...",
  "status": "restarting"
}
```

## Características del Servicio

### Reconexión Automática

- **Período de reconexión:** 5 segundos
- **Máximos intentos:** 10
- **Timeout de conexión:** 30 segundos

### Will Message

En caso de desconexión inesperada, el broker publicará automáticamente:
- **Topic:** `termostato/status/online`
- **Payload:** `{"value": false, "timestamp": "..."}`

### Gestión de Errores

- Errores MQTT no interrumpen el funcionamiento del termostato
- Logs detallados de conexión/desconexión
- Validación de payloads JSON
- Manejo graceful de mensajes malformados

### Sincronización Bidireccional

- Cambios desde Home Assistant se reflejan inmediatamente en la UI web local
- Cambios desde la UI web se publican inmediatamente via MQTT
- Estado siempre sincronizado entre ambas interfaces

## Instalación en Raspberry Pi

### 1. Instalar Mosquitto

```bash
sudo apt update
sudo apt install mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

### 2. Configuración Mosquitto (Opcional)

Crear `/etc/mosquitto/conf.d/local.conf`:

```
listener 1883
allow_anonymous true
persistence true
persistence_location /var/lib/mosquitto/
log_dest file /var/log/mosquitto/mosquitto.log
```

### 3. Reiniciar Mosquitto

```bash
sudo systemctl restart mosquitto
```

### 4. Verificar Funcionamiento

```bash
# Terminal 1 - Suscribirse a todos los topics del termostato
mosquitto_sub -h localhost -t "termostato/#" -v

# Terminal 2 - Enviar comando de prueba
mosquitto_pub -h localhost -t "termostato/setpoint/set" -m '{"value": 25.0}'
```

## Troubleshooting

### El servicio MQTT no se conecta

1. Verificar que Mosquitto esté ejecutándose:
   ```bash
   sudo systemctl status mosquitto
   ```

2. Verificar logs del backend:
   ```bash
   # En el directorio del backend
   npm run dev
   ```

3. Probar conexión manual:
   ```bash
   mosquitto_pub -h localhost -t "test" -m "hello"
   ```

### Home Assistant no recibe actualizaciones

1. Verificar configuración MQTT en Home Assistant
2. Comprobar logs de Home Assistant
3. Verificar que los topics se estén publicando:
   ```bash
   mosquitto_sub -h localhost -t "termostato/status/#" -v
   ```

### Comandos desde Home Assistant no funcionan

1. Verificar formato de los payloads JSON
2. Comprobar logs del backend para errores de parsing
3. Probar comando manual:
   ```bash
   mosquitto_pub -h localhost -t "termostato/setpoint/set" -m '{"value": 23.0}'
   ```
