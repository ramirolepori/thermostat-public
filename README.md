# 🌡️ Smart Thermostat MVP

Un termostato inteligente modular con integración completa para Home Assistant, desarrollado con TypeScript, React y MQTT.

## 📋 Características

- 🏠 **Integración nativa con Home Assistant** via MQTT
- 🌡️ **Control de temperatura preciso** con sensor DS18B20
- 🔄 **Control automático y manual** del sistema de calefacción
- 📱 **Interfaz web responsive** desarrollada en React
- ⚡ **Backend escalable** con Node.js y TypeScript
- 🗄️ **Persistencia de datos** con MongoDB
- 🔌 **Control de hardware** para Raspberry Pi (GPIO)
- 🖥️ **Modo desarrollo** con hardware simulado
- 📊 **Escenas programables** para automatización avanzada
- 🔄 **Actualizaciones en tiempo real** entre todos los componentes

## 🏗️ Arquitectura

```
┌─────────────────┐    MQTT    ┌──────────────────┐
│  Home Assistant │ ◄────────► │  MQTT Broker     │
└─────────────────┘            │  (Mosquitto)     │
                               └──────────────────┘
                                        ▲
                                        │ MQTT
                                        ▼
┌─────────────────┐    HTTP    ┌──────────────────┐
│   React Frontend│ ◄────────► │   Node.js        │
│   (Port 5173)   │            │   Backend        │
└─────────────────┘            │   (Port 3001)    │
                               └──────────────────┘
                                        │
                                        ▼
                               ┌──────────────────┐
                               │    MongoDB       │
                               │   (Database)     │
                               └──────────────────┘
                                        │
                                        ▼
                               ┌──────────────────┐
                               │  Raspberry Pi    │
                               │   Hardware       │
                               │ (GPIO/Sensors)   │
                               └──────────────────┘
```

## 🚀 Instalación Rápida

### Prerrequisitos

- **Node.js** 18+ y npm
- **MongoDB** (local o MongoDB Atlas)
- **MQTT Broker** (Mosquitto recomendado)
- **Raspberry Pi** (para control de hardware real)

### 1. Clonar el repositorio

```bash
git clone https://github.com/ramirolepori/thermostat-public.git
cd thermostat-public
```

### 2. Configurar Backend

```bash
cd backend
npm install

# Copiar y configurar variables de entorno
cp .env.example .env
# Editar .env con tus configuraciones
```

### 3. Configurar Frontend

```bash
cd ../frontend
npm install
```

### 4. Configurar Base de Datos

Crear una base de datos MongoDB y actualizar `MONGODB_URI` en el archivo `.env`.

### 5. Configurar MQTT

Instalar y configurar Mosquitto:

```bash
# Ubuntu/Debian
sudo apt-get install mosquitto mosquitto-clients

# macOS
brew install mosquitto

# Iniciar el servicio
sudo systemctl start mosquitto
```

## ⚙️ Configuración

### Variables de Entorno (Backend)

```env
# Base de datos
MONGODB_URI=mongodb://localhost:27017/thermostat

# Servidor
PORT=3001
NODE_ENV=development

# MQTT
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_CLIENT_ID=termostato_backend

# Hardware GPIO (Raspberry Pi)
SENSOR_GPIO_PIN=4
RELAY_GPIO_PIN=18
```

### Configuración de Home Assistant

Agregar al archivo `configuration.yaml`:

```yaml
# MQTT Configuration
mqtt:
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

  sensor:
    - name: "Temperatura Actual Termostato"
      state_topic: "termostato/status/temperatura"
      value_template: "{{ value_json.value }}"
      unit_of_measurement: "°C"
      device_class: "temperature"
      availability_topic: "termostato/status/online"
```

## 🏃‍♂️ Ejecución

### Desarrollo

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: MQTT (si es necesario)
mosquitto -v
```

### Producción

```bash
# Construir frontend
cd frontend
npm run build

# Construir y ejecutar backend
cd ../backend
npm run build
npm start
```

## 🔧 Uso

### Interfaz Web

1. Abrir `http://localhost:5173` en el navegador
2. Ajustar temperatura objetivo
3. Activar/desactivar modo automático
4. Configurar escenas de automatización

### Home Assistant

1. El termostato aparecerá como `climate.termostato_inteligente`
2. Controlar desde la interfaz de HA o automatizaciones
3. Ver sensores adicionales en el panel de entidades

### API REST

```bash
# Obtener estado actual
GET http://localhost:3001/api/status

# Establecer temperatura
POST http://localhost:3001/api/setpoint
Content-Type: application/json
{"temperature": 22}

# Activar/desactivar
POST http://localhost:3001/api/enable
Content-Type: application/json
{"enabled": true}
```

## 📡 Protocolo MQTT

### Topics de Estado (Solo lectura)

- `termostato/status/temperatura` - Temperatura actual
- `termostato/status/setpoint` - Temperatura objetivo
- `termostato/status/enabled` - Estado activado/desactivado
- `termostato/status/heating` - Estado del relé de calefacción
- `termostato/status/online` - Estado de conectividad

### Topics de Control (Escritura)

- `termostato/control/setpoint` - Cambiar temperatura objetivo
- `termostato/control/enabled` - Activar/desactivar termostato
- `termostato/control/manual_relay` - Control manual del relé

### Formato de Mensajes

```json
{
  "value": <valor>,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 🛠️ Desarrollo

### Estructura del Proyecto

```
├── backend/                 # Servidor Node.js
│   ├── src/
│   │   ├── database/       # Modelos de MongoDB
│   │   ├── hardware/       # Control GPIO/Sensores
│   │   ├── routes/         # Rutas API REST
│   │   └── services/       # Lógica MQTT y termostato
│   └── package.json
├── frontend/               # Aplicación React
│   ├── src/
│   │   ├── components/     # Componentes UI
│   │   ├── api/           # Cliente HTTP
│   │   └── styles/        # Estilos CSS
│   └── package.json
├── scripts/               # Scripts de despliegue
└── README.md
```

### Modo Desarrollo (Sin Hardware)

El sistema detecta automáticamente si se ejecuta en Raspberry Pi o en un entorno de desarrollo:

- **Raspberry Pi**: Usa GPIO real y sensor DS18B20
- **Desarrollo**: Usa sensores simulados con valores realistas

### Contribuir

1. Fork el repositorio
2. Crear una rama para la feature: `git checkout -b feature/nueva-feature`
3. Commit los cambios: `git commit -am 'Add nueva feature'`
4. Push a la rama: `git push origin feature/nueva-feature`
5. Crear un Pull Request

## 📊 Características Técnicas

### Hardware Compatible

- **Raspberry Pi** (todos los modelos con GPIO)
- **Sensor de temperatura**: DS18B20 (1-Wire)
- **Relé**: Compatible con GPIO (3.3V/5V)
- **Conexiones**:
  - DS18B20 → GPIO 4 (configurable)
  - Relé → GPIO 18 (configurable)

### Especificaciones

- **Precisión de temperatura**: ±0.5°C
- **Rango de operación**: -10°C a 85°C
- **Frecuencia de muestreo**: 5 segundos (configurable)
- **Latencia MQTT**: <100ms
- **Persistencia**: MongoDB con TTL automático

## 🐛 Solución de Problemas

### Problemas Comunes

**Backend no conecta a MQTT**
```bash
# Verificar que Mosquitto esté ejecutándose
sudo systemctl status mosquitto

# Probar conexión manual
mosquitto_pub -h localhost -t test -m "hello"
```

**Sensor no detectado en Raspberry Pi**
```bash
# Verificar módulos 1-Wire
sudo modprobe w1-gpio
sudo modprobe w1-therm

# Listar sensores detectados
ls /sys/bus/w1/devices/
```

**Home Assistant no recibe datos**
```bash
# Verificar topics MQTT
mosquitto_sub -h localhost -t "termostato/status/#"
```

## 📄 Licencia

MIT License - ver [LICENSE](LICENSE) para más detalles.

## 🙋‍♂️ Autor

**Ramiro Lepori**
- GitHub: [@ramirolepori](https://github.com/ramirolepori)

## 🌟 Agradecimientos

- [Home Assistant](https://www.home-assistant.io/) por la plataforma de domótica
- [MQTT.org](https://mqtt.org/) por el protocolo de comunicación
- Comunidad de Raspberry Pi por las librerías de hardware

---

⭐ **¡Si este proyecto te resulta útil, considera darle una estrella!** ⭐