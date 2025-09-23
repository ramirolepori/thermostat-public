// Configuración del pin GPIO para el relé
const GPIO_PIN = 17;     // GPIO 17 (pin 11) como salida
const RELAY_ON = 0;      // Valor para activar el relé (activo bajo)
const RELAY_OFF = 1;     // Valor para desactivar el relé (activo bajo)

// Estado del relé
let relayState = false;

let relay: any = null;

// Inicializar el hardware
try {
  const { Gpio } = require('pigpio');
  relay = new Gpio(GPIO_PIN, {mode: Gpio.OUTPUT});
  relay.digitalWrite(RELAY_OFF);
  console.log(`✅ Relé inicializado correctamente en GPIO ${GPIO_PIN} (apagado)`);
} catch (error) {
  console.error('❌ Error al inicializar pigpio:', error);
  process.exit(1);
}

/**
 * Enciende el relé
 * @returns true si la operación fue exitosa, false si hubo error
 */
export function turnOnRelay(): boolean {
  try {
    relay.digitalWrite(RELAY_ON);
    relayState = true;
    console.log("Relé encendido");
    return true;
  } catch (error) {
    console.error("Error al encender el relé:", error);
    return false;
  }
}

/**
 * Apaga el relé
 * @returns true si la operación fue exitosa, false si hubo error
 */
export function turnOffRelay(): boolean {
  try {
    relay.digitalWrite(RELAY_OFF);
    relayState = false;
    console.log("Relé apagado");
    return true;
  } catch (error) {
    console.error("Error al apagar el relé:", error);
    return false;
  }
}

/**
 * Obtiene el estado actual del relé
 * @returns true si el relé está encendido, false si está apagado
 */
export function getRelayState(): boolean {
  return relayState;
}

/**
 * Conmuta el estado del relé (si estaba encendido lo apaga, si estaba apagado lo enciende)
 * @returns true si la operación fue exitosa, false si hubo error
 */
export function toggleRelay(): boolean {
  return relayState ? turnOffRelay() : turnOnRelay();
}

// Manejadores para limpiar GPIO al terminar el programa
process.on('SIGINT', () => {
  relay.digitalWrite(RELAY_OFF);
  console.log("\nGPIO liberado, saliendo...");
  process.exit(0);
});

['SIGTERM', 'SIGHUP'].forEach(signal => {
  process.on(signal, () => {
    relay.digitalWrite(RELAY_OFF);
    console.log(`\nGPIO liberado por señal ${signal}, saliendo...`);
    process.exit(0);
  });
});
