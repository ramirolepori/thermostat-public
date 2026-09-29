/**
 * Simulación del controlador TPI contra un modelo térmico simple de habitación.
 * No forma parte del runtime; se usa solo para validar la lógica de control.
 *
 * Correr: npx ts-node src/sim-tpi.ts
 */
import { computeDesiredRelay, resetTPI, DEFAULT_TPI } from './services/tpiController';

const SETPOINT = 20;
const AMBIENT = 12;          // °C exterior/equilibrio sin calefacción
const HEAT_RATE = 0.06;      // °C por minuto cuando el radiador entrega (con inercia)
const LOSS_RATE = 0.015;     // °C por minuto de pérdida hacia el ambiente
const RADIATOR_LAG_MIN = 3;  // el radiator sigue irradiando N min tras apagar

function run(startTemp: number, hours: number) {
  resetTPI();
  let temp = startTemp;
  let relayOn = false;
  let radiatorHeat = 0; // inercia: minutos de calor residual
  let transitions = 0;
  let prevOn = false;
  const stepMin = 1;
  const totalMin = hours * 60;

  console.log(`\n=== Simulación: start=${startTemp}°C, setpoint=${SETPOINT}°C, ambient=${AMBIENT}°C ===`);
  console.log('min\ttemp\trelay\tduty\tmode');

  for (let t = 0; t <= totalMin; t += stepMin) {
    const nowMs = t * 60 * 1000;
    const d = computeDesiredRelay(temp, SETPOINT, DEFAULT_TPI, nowMs);
    relayOn = d.on;
    if (relayOn !== prevOn) { transitions++; prevOn = relayOn; }

    // Modelo térmico: inercia del radiador + pérdida hacia ambiente.
    if (relayOn) radiatorHeat = RADIATOR_LAG_MIN;
    else if (radiatorHeat > 0) radiatorHeat -= stepMin;

    if (radiatorHeat > 0) temp += HEAT_RATE * stepMin;
    temp -= LOSS_RATE * (temp - AMBIENT) * stepMin * 0.1; // pérdida proporcional

    if (t % 15 === 0) {
      console.log(`${t}\t${temp.toFixed(2)}\t${relayOn ? 'ON ' : 'off'}\t${(d.duty * 100).toFixed(0)}%\t${d.mode}`);
    }
  }

  const cyclesPerHour = transitions / 2 / hours;
  // Métricas de la última mitad (régimen permanente).
  console.log(`Transiciones totales: ${transitions}  (~${cyclesPerHour.toFixed(1)} ciclos/hora)`);
}

/**
 * Escenario con cambio de setpoint a mitad de camino: valida que al volver a la
 * banda de cycling el duty se recalcule de inmediato (sin quedar trabado).
 */
function runSetpointChange() {
  resetTPI();
  let temp = 20;
  let radiatorHeat = 0;
  let stuckOff = 0; // minutos seguidos apagado dentro de la banda con temp < setpoint
  console.log(`\n=== Cambio de setpoint: 20 (1h) -> 18 (30min) -> 20 (1h) ===`);
  console.log('min\tsetpt\ttemp\trelay\tduty\tmode');
  for (let t = 0; t <= 150; t += 1) {
    const setpoint = t < 60 ? 20 : t < 90 ? 18 : 20;
    const d = computeDesiredRelay(temp, setpoint, DEFAULT_TPI, t * 60 * 1000);
    if (d.on) radiatorHeat = RADIATOR_LAG_MIN; else if (radiatorHeat > 0) radiatorHeat -= 1;
    if (radiatorHeat > 0) temp += HEAT_RATE;
    temp -= LOSS_RATE * (temp - AMBIENT) * 0.1;
    // Detectar "trabado apagado": en la fase final (setpoint 20) por debajo del objetivo y sin encender.
    if (t > 90 && setpoint - temp > 0.3 && !d.on) stuckOff++; else if (d.on) stuckOff = 0;
    if (t % 10 === 0 || t === 91) console.log(`${t}\t${setpoint}\t${temp.toFixed(2)}\t${d.on ? 'ON ' : 'off'}\t${(d.duty * 100).toFixed(0)}%\t${d.mode}`);
  }
  console.log(`Máx minutos trabado-apagado bajo objetivo en fase final: ${stuckOff} (debe ser bajo)`);
}

/**
 * Reproduce el bug reportado: estando en cycling (setpoint por encima de la
 * temperatura, caldera pulsando), se baja el setpoint hasta la temperatura
 * actual. La caldera debe apagarse enseguida, no seguir corriendo minutos con
 * el duty viejo + integral acumulado.
 */
function runLowerSetpointToTemp() {
  resetTPI();
  let temp = 19;
  let radiatorHeat = 0;
  let onAfterLower = 0; // minutos encendido tras bajar el setpoint a la temp actual
  console.log(`\n=== Bajar setpoint a la temp actual: 19.5 (40min, temp~19) -> 19 ===`);
  console.log('min\tsetpt\ttemp\trelay\tduty\tinteg\tmode');
  for (let t = 0; t <= 80; t += 1) {
    const setpoint = t < 40 ? 19.5 : 19;
    const d = computeDesiredRelay(temp, setpoint, DEFAULT_TPI, t * 60 * 1000);
    if (d.on) radiatorHeat = RADIATOR_LAG_MIN; else if (radiatorHeat > 0) radiatorHeat -= 1;
    if (radiatorHeat > 0) temp += HEAT_RATE;
    temp -= LOSS_RATE * (temp - AMBIENT) * 0.1;
    if (t >= 40 && d.on) onAfterLower++;
    if (t % 5 === 0 || t === 40 || t === 41) {
      console.log(`${t}\t${setpoint}\t${temp.toFixed(2)}\t${d.on ? 'ON ' : 'off'}\t${(d.duty * 100).toFixed(0)}%\t${d.integral.toFixed(2)}\t${d.mode}`);
    }
  }
  console.log(`Minutos encendido tras bajar el setpoint: ${onAfterLower} (debe ser ~0)`);
}

// Solo correr si se ejecuta directamente (no al importar el módulo).
if (require.main === module) {
  run(18, 6);   // arranque en frío
  run(20.6, 3); // arranque por encima del setpoint (debe apagar y mantener)
  runSetpointChange();
  runLowerSetpointToTemp();
}
