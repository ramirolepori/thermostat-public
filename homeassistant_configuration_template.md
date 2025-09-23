# Configuración de Home Assistant para Termostato MVP

Este archivo contiene ejemplos de configuración para integrar el termostato con Home Assistant.

## Configuración Principal (configuration.yaml)

```yaml
# Configuración MQTT para Termostato Inteligente
mqtt:
  # Entidad principal del termostato
  climate:
    - name: "Termostato Inteligente"
      current_temperature_topic: "termostato/status/temperatura"
      current_temperature_template: "{{ value_json.value }}"
      temperature_command_topic: "termostato/control/setpoint"
      temperature_state_topic: "termostato/status/setpoint"
      temperature_state_template: "{{ value_json.value }}"
      mode_command_topic: "termostato/control/enabled"
      mode_state_topic: "termostato/status/enabled"
      mode_state_template: >
        {% if value_json.value == true %}heat{% else %}off{% endif %}
      modes: ["heat", "off"]
      availability_topic: "termostato/status/online"
      payload_available: "true"
      payload_not_available: "false"
      min_temp: 5
      max_temp: 35
      temp_step: 0.5
      precision: 0.1

  # Sensores adicionales
  sensor:
    - name: "Temperatura Actual Termostato"
      state_topic: "termostato/status/temperatura"
      value_template: "{{ value_json.value }}"
      unit_of_measurement: "°C"
      device_class: "temperature"
      availability_topic: "termostato/status/online"
      payload_available: "true"
      payload_not_available: "false"

    - name: "Setpoint Termostato"
      state_topic: "termostato/status/setpoint"
      value_template: "{{ value_json.value }}"
      unit_of_measurement: "°C"
      device_class: "temperature"
      availability_topic: "termostato/status/online"

  # Sensores binarios
  binary_sensor:
    - name: "Calefacción Activa"
      state_topic: "termostato/status/heating"
      value_template: "{{ value_json.value }}"
      payload_on: true
      payload_off: false
      device_class: "heat"
      availability_topic: "termostato/status/online"

  # Switch para control manual
  switch:
    - name: "Control Manual Calefacción"
      command_topic: "termostato/control/manual_relay"
      state_topic: "termostato/status/heating"
      value_template: "{{ value_json.value }}"
      payload_on: '{"value": true}'
      payload_off: '{"value": false}'
      state_on: true
      state_off: false
      availability_topic: "termostato/status/online"
```

## Configuración Simplificada para Testing

Si prefieres una configuración más simple para probar:

```yaml
mqtt:
  climate:
    - name: "Termostato Simple"
      current_temperature_topic: "termostato/status/temperatura"
      current_temperature_template: "{{ value_json.value }}"
      temperature_command_topic: "termostato/control/setpoint"
      temperature_state_topic: "termostato/status/setpoint"
      temperature_state_template: "{{ value_json.value }}"
      modes: ["heat", "off"]
      mode_command_topic: "termostato/control/enabled"
      mode_state_topic: "termostato/status/enabled"
      mode_state_template: >
        {% if value_json.value == true %}heat{% else %}off{% endif %}

  sensor:
    - name: "Temperatura Actual"
      state_topic: "termostato/status/temperatura"
      value_template: "{{ value_json.value }}"
      unit_of_measurement: "°C"
      device_class: "temperature"
```

## Automatizaciones de Ejemplo

### Automatización básica de temperatura por horario:

```yaml
automation:
  - alias: "Termostato Mañana"
    trigger:
      platform: time
      at: "07:00:00"
    action:
      service: climate.set_temperature
      target:
        entity_id: climate.termostato_inteligente
      data:
        temperature: 22

  - alias: "Termostato Noche"
    trigger:
      platform: time
      at: "22:00:00"
    action:
      service: climate.set_temperature
      target:
        entity_id: climate.termostato_inteligente
      data:
        temperature: 18
```

### Notificación cuando se activa la calefacción:

```yaml
automation:
  - alias: "Notificar Calefacción Activada"
    trigger:
      platform: state
      entity_id: binary_sensor.calefaccion_activa
      to: "on"
    action:
      service: notify.persistent_notification
      data:
        message: "La calefacción se ha activado. Temperatura actual: {{ states('sensor.temperatura_actual_termostato') }}°C"
        title: "Termostato"
```

## Configuración del Broker MQTT

### Instalación de Mosquitto (Ubuntu/Debian):

```bash
sudo apt-get update
sudo apt-get install mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

### Configuración básica de Mosquitto (/etc/mosquitto/mosquitto.conf):

```
# Configuración básica
persistence true
persistence_location /var/lib/mosquitto/

# Log configuration
log_dest file /var/log/mosquitto/mosquitto.log
log_type all

# Puerto por defecto
port 1883

# Configuración de red
allow_anonymous true

# Configuración de keepalive
max_keepalive 65535
```

### Testing de conexión MQTT:

```bash
# Suscribirse a todos los topics del termostato
mosquitto_sub -h localhost -t "termostato/#"

# Enviar comando de prueba
mosquitto_pub -h localhost -t "termostato/control/setpoint" -m '{"value": 22, "timestamp": "2024-01-01T12:00:00.000Z"}'
```

## Tarjetas de Lovelace UI

### Tarjeta básica del termostato:

```yaml
type: thermostat
entity: climate.termostato_inteligente
name: Termostato Inteligente
```

### Tarjeta con sensores adicionales:

```yaml
type: entities
title: Control de Temperatura
entities:
  - entity: climate.termostato_inteligente
    name: Termostato
  - entity: sensor.temperatura_actual_termostato
    name: Temperatura Actual
  - entity: sensor.setpoint_termostato
    name: Temperatura Objetivo
  - entity: binary_sensor.calefaccion_activa
    name: Calefacción Activa
  - entity: switch.control_manual_calefaccion
    name: Control Manual
```

## Solución de Problemas

### Verificar conexión MQTT:
1. Comprobar que Mosquitto esté ejecutándose: `sudo systemctl status mosquitto`
2. Verificar logs: `tail -f /var/log/mosquitto/mosquitto.log`
3. Probar publicación manual: `mosquitto_pub -h localhost -t test -m "hello"`

### Verificar entidades en Home Assistant:
1. Ir a Herramientas de Desarrollo > Estados
2. Buscar entidades que empiecen con `climate.termostato` o `sensor.temperatura`
3. Verificar que el estado no sea "unavailable"

### Verificar plantillas Jinja2:
1. Ir a Herramientas de Desarrollo > Plantillas
2. Probar plantillas individualmente:
```jinja2
{{ states('sensor.temperatura_actual_termostato') }}
{{ state_attr('climate.termostato_inteligente', 'current_temperature') }}
```