# Backend Thermostat - Documentación Técnica

## Descripción
Este backend controla un termostato inteligente basado en Node.js, Express y TypeScript. Gestiona la lectura de sensores, el control de relé y la lógica de histéresis.

## Estructura principal
- **src/services/logic.ts**: Lógica principal del termostato (control, validaciones, errores).
- **src/routes/routes.ts**: Endpoints REST para frontend y API.
- **src/hardware/**: Acceso a hardware (sensor de temperatura y relé GPIO).
- **ecosystem.config.js**: Configuración de PM2 para producción.

## Instalación y ejecución
1. Instala dependencias:
   ```bash
   npm install
   ```
2. Compila el backend:
   ```bash
   npm run build
   ```
3. Configura las variables de entorno en `.env`.
4. Inicia con PM2:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   ```

## Endpoints principales
- `GET /api/temperature` — Devuelve la temperatura actual.
- `GET /api/status` — Estado completo del termostato.
- `POST /api/target-temperature` — Cambia la temperatura objetivo.
- `POST /api/hysteresis` — Cambia la histéresis.
- `POST /api/thermostat/start|stop|reset` — Controla el ciclo de vida.

## Buenas prácticas implementadas
- Validación centralizada de parámetros.
- Manejo robusto de errores y logs.
- Intervalo de chequeo optimizado (3s por defecto).
- Endpoints protegidos y claros.
- Código modular y documentado.

## Troubleshooting
- Revisa los logs en `./logs/err.log` y `./logs/out.log`.
- Si el sensor falla, el sistema pausa el termostato pero no cae el backend.
- Para reiniciar el sistema tras un error: `POST /api/thermostat/reset`.

## Notas
- El backend solo escucha en localhost por seguridad. Usa Nginx como proxy si expones el servicio.
- Para escalar, ajusta `instances` en PM2 y revisa el uso de recursos.

---

> Última actualización: 2025-05-20
