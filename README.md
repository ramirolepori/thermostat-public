# Termostato inteligente para Raspberry Pi

Backend de un termostato casero que maneja una caldera por relé. Sensa la temperatura, decide cuándo prender con control **TPI** (Time Proportional & Integral) y se integra con **HomeKit** a través de Home Assistant y Homebridge, por **MQTT**.

Lo empecé como proyecto personal en abril de 2025 con un on/off simple. En junio de 2026 lo pasé a TPI. El proyecto sigue vivo: lo uso todos los días en mi casa.

## Cómo decide la caldera

El control corre cada 3 segundos y mira el error `e = setpoint - temperatura`.

| Situación | Qué hace |
| --- | --- |
| `e` >= 1,5 °C (banda proporcional) | Caldera prendida todo el ciclo |
| `e` entre 0 y 1,5 °C | Pulsa: prende `e / 1,5` del ciclo de 20 minutos, más un término integral |
| Se llegó al objetivo | Apagada. No vuelve a prender hasta que la temperatura baja 0,5 °C (banda muerta) |

Con un encendido mínimo de 2 minutos y un apagado mínimo de 3, para no maltratar la caldera. Los parámetros están en `backend/src/services/tpiController.ts`.

### Fail-safe

El sensor (DS18B20) devuelve de vez en cuando una lectura con CRC inválido. Se descarta y se reintenta. Se descartan también el valor centinela de 85 °C y lecturas fuera de -10 a 80 °C. Si fallan 5 lecturas seguidas se apaga el relé, pero el termostato sigue reintentando y retoma el control solo cuando vuelve una lectura válida.

### Simulador térmico

Para cambiar el control sin tocar la caldera hay un simulador con un modelo simple de habitación:

```bash
cd backend
npm ci --ignore-scripts
npx ts-node src/sim-tpi.ts
```

Imprime la evolución de temperatura, duty, modo y ciclos por hora en varios escenarios. Es un modelo aproximado, sirve para detectar comportamientos raros, no para predecir la casa real.

## Arquitectura

```
sensor DS18B20 + relé (GPIO)  <->  backend Node/TypeScript (TPI)  <->  MQTT (Mosquitto)  <->  Home Assistant / Homebridge  <->  HomeKit
```

- **Hardware:** Raspberry Pi 3 Model B, sensor DS18B20 por 1-Wire, relé activo-bajo en el GPIO 17 (con `pigpio`).
- **Backend:** Node.js, TypeScript, Express, Helmet y el cliente `mqtt`. Se corre con PM2, con reinicio si pasa de 200 MB.
- **API HTTP:** escucha solo en `127.0.0.1:3001`. Hacia afuera se comunica por MQTT.
- **Estado:** el setpoint y el modo se guardan en un archivo JSON local (`THERMOSTAT_STATE_FILE`).

### MQTT

Broker `mqtt://localhost:1883` por defecto (`MQTT_BROKER_URL`). Payloads con la forma `{ "value": <v>, "timestamp": <ISO> }`.

- Estado: `termostato/status/{online,temperature,relay,setpoint,mode}`
- Comandos: `termostato/setpoint/set`, `termostato/mode/set`

Más detalle en [backend/MQTT_README.md](backend/MQTT_README.md). Un ejemplo de configuración de Home Assistant está en `homeassistant_configuration_simple.yaml`.

## Puesta en marcha

Requiere Node 18+, un broker MQTT y, para el hardware real, una Raspberry Pi con `pigpio`.

```bash
cd backend
npm ci
npm run build
cp .env.example .env   # opcional: PORT, MQTT_BROKER_URL, MQTT_CLIENT_ID, THERMOSTAT_STATE_FILE
npm start
```

`pigpio` necesita acceso a GPIO y hoy el backend corre como root en la Pi. Es lo que más me gustaría mejorar.

## Estado

Sin tests automáticos: la lógica de control se valida con el simulador y en la Pi real. No hay CI, el deploy es manual.

## Licencia

MIT
