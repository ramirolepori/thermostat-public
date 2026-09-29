import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import routes from './routes/routes';
import { startThermostat, wasRunningPersisted, startTemperatureMonitor } from './services/logic';
import { initializeMqtt, stopMqtt } from './services/mqtt';
import { cpus, networkInterfaces } from 'os';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
// Cambiar HOST para que solo escuche en localhost, evitando acceso directo desde fuera
const HOST = '127.0.0.1'; // Solo escuchar en localhost
const isProd = process.env.NODE_ENV === 'production';

// Función para obtener la IP del dispositivo
function getLocalIP(): string {
  const nets = networkInterfaces();
  let localIP = 'localhost';
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Omitir interfaces loopback e IPv6
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        return localIP;
      }
    }
  }
  
  return localIP;
}

// Aplicar middleware de seguridad básica (solo en producción)
app.use(helmet());

// Middleware para comprimir respuestas
app.use(compression());

// Configurar CORS. La API solo escucha en localhost, así que CORS es marginal;
// se deja permisivo pero SIN credentials (origin '*' + credentials:true es una
// combinación inválida que los navegadores rechazan).
// La API escucha solo en localhost y no tiene frontend: no se habilita CORS.

// Parsear JSON con límite para evitar ataques de payload grandes
app.use(express.json({ limit: '100kb' }));

// Timeout extendido para conexiones lentas
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    res.status(408).send('Request timeout');
  });
  next();
});

// Cache control para respuestas estáticas
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, max-age=300'); // 5 minutos
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Logging sencillo
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 500) { // Solo logear peticiones lentas
      console.log(`[SLOW] ${req.method} ${req.originalUrl} - ${duration}ms`);
    }
  });
  next();
});

// Middleware para rechazar rutas sin el prefijo /api para APIs
app.use(['/health', '/temperature', '/status', '/target-temperature', '/thermostat/*'], (req, res) => {
  return res.status(404).json({
    error: `Endpoint no encontrado. Usa el prefijo '/api' para acceder a los endpoints de la API: /api${req.url}`
  });
});

// Montar las rutas
app.use('/api', routes);

// Manejador global de errores
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`Error en ${req.method} ${req.path}:`, err.message);
  res.status(500).json({
    error: isProd ? 'Error interno del servidor' : err.message
  });
});

// Iniciar el servidor solo en localhost
app.listen(PORT, HOST, () => {
  const localIP = getLocalIP();
  console.log(`✅ Backend corriendo en http://${HOST}:${PORT} (${isProd ? 'producción' : 'desarrollo'})`);
  console.log(`ℹ️  API accesible solo desde localhost (IP del equipo: ${localIP}). La integración con HomeKit va por MQTT.`);
  console.log(`✅ Servidor optimizado para ${cpus().length} CPU(s)`);
  
  // Iniciar el termostato solo si el último modo persistido no era OFF. Así un
  // reinicio del proceso o un corte de luz respeta que el usuario lo dejó apagado
  // (y, si estaba encendido, la calefacción se reanuda sola).
  if (wasRunningPersisted()) {
    startThermostat();
    console.log('✅ Termostato iniciado (modo encendido)');
  } else {
    console.log('ℹ️  Termostato en OFF según el estado persistido: no se inicia automáticamente.');
  }

  // Monitor de temperatura para display: corre siempre (incluso en OFF) para que
  // HomeKit/HA muestren la temperatura del ambiente.
  startTemperatureMonitor();

  // Inicializar servicio MQTT después de un breve delay para que el termostato esté listo
  setTimeout(() => {
    console.log('🚀 Inicializando servicio MQTT...');
    initializeMqtt();
  }, 2000);
});

// Manejar señales de cierre para limpiar recursos
process.on('SIGINT', () => {
  console.log('\n🛑 Recibida señal SIGINT, cerrando servicios...');
  stopMqtt();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Recibida señal SIGTERM, cerrando servicios...');
  stopMqtt();
  process.exit(0);
});
