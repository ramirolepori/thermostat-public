/**
 * Controlador TPI (Time Proportional & Integral) para calefacción.
 *
 * En vez de un on/off duro con histéresis (que deja la temperatura oscilar
 * dentro de una banda ancha), el TPI modula la caldera con un *duty cycle*
 * proporcional al error de temperatura, más un término integral que elimina el
 * error en régimen permanente. Es el patrón que usan los termostatos comerciales
 * (Honeywell/Nest) para radiadores.
 *
 * Comportamiento:
 *  - Muy por debajo del setpoint (error ≥ banda proporcional): caldera CONTINUA.
 *  - Dentro de la banda proporcional: pulsa con duty = error/banda + integral.
 *  - En o por encima del setpoint: caldera apagada (el integral decae).
 *
 * El número de ciclos por hora limita el desgaste de la caldera (anti-ciclado
 * corto), y min-on/min-off evitan pulsos demasiado cortos.
 */

export interface TPIParams {
  proportionalBand: number;     // °C sobre los que el duty va de 0% a 100%
  cyclePeriodMs: number;        // duración de un ciclo (define ciclos/hora)
  integralGainPerCycle: number; // cuánto acumula el integral por °C de error y ciclo
  integralMax: number;          // tope del aporte integral al duty (0..1)
  minOnMs: number;              // tiempo mínimo de encendido por ciclo
  minOffMs: number;             // tiempo mínimo de apagado por ciclo
  offMargin: number;            // °C por encima del setpoint para forzar apagado
  deadband: number;             // °C de banda muerta: al llegar al setpoint no
                                // reenciende hasta que la temp baje este margen
}

const CYCLES_PER_HOUR = 3; // típico para radiadores

export const DEFAULT_TPI: TPIParams = {
  proportionalBand: 1.5,
  cyclePeriodMs: Math.round((60 * 60 * 1000) / CYCLES_PER_HOUR), // 20 min
  integralGainPerCycle: 0.1,
  integralMax: 0.4,
  minOnMs: 2 * 60 * 1000,
  minOffMs: 3 * 60 * 1000,
  offMargin: 0.2,
  deadband: 0.5,
};

export interface TPIDecision {
  on: boolean;        // ¿debe estar encendida la caldera ahora?
  duty: number;       // fracción de encendido del ciclo actual (0..1)
  integral: number;   // estado del término integral (diagnóstico)
  mode: 'continuous' | 'cycling' | 'off';
}

// --- Estado interno del controlador ---
let integral = 0;
let cycleStart = 0;           // epoch ms del inicio del ciclo de cycling actual
let currentDuty = 0;
let lastMode: TPIDecision['mode'] = 'off';
let lastSetpoint = NaN;       // setpoint de la evaluación anterior (detecta cambios)
let satisfied = false;        // latch de banda muerta: true mientras se alcanzó el
                              // setpoint y aún no bajó `deadband` para reencender

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Reinicia el estado del controlador (al arrancar el termostato).
 * `cycleStart = 0` actúa de centinela para forzar el cálculo del duty en la
 * primera evaluación dentro de la banda.
 */
export function resetTPI(): void {
  integral = 0;
  cycleStart = 0;
  currentDuty = 0;
  lastMode = 'off';
  lastSetpoint = NaN;
  satisfied = false;
}

/**
 * Recalcula el duty del ciclo a partir del error y el integral. Se invoca al
 * iniciar cada ciclo de cycling (no por tick).
 */
function recomputeDuty(error: number, p: TPIParams): void {
  // Acumular integral por ciclo, acotado a [0, integralMax] (anti-windup).
  integral = clamp(integral + p.integralGainPerCycle * error, 0, p.integralMax);

  let duty = clamp(error / p.proportionalBand + integral, 0, 1);

  // Evitar pulsos demasiado cortos: si el encendido sería menor al mínimo,
  // no encender (salvo que ya esté cerca); si el apagado sería menor al
  // mínimo, encender todo el ciclo.
  const onMs = duty * p.cyclePeriodMs;
  if (onMs > 0 && onMs < p.minOnMs) {
    duty = onMs >= p.minOnMs / 2 ? p.minOnMs / p.cyclePeriodMs : 0;
  } else if (onMs > 0 && p.cyclePeriodMs - onMs < p.minOffMs) {
    duty = 1;
  }

  currentDuty = duty;
}

/**
 * Decide si la caldera debe estar encendida en este instante.
 *
 * Fuera de la banda proporcional el comportamiento es on/off directo (continuo
 * si está muy por debajo del setpoint, apagado si lo superó). Dentro de la banda
 * modula con duty cycle. El integral solo se mueve en los límites de ciclo de
 * cycling; en los modos continuous/off se fija de forma idempotente para entrar
 * suavemente a la banda y no sobrecalentar.
 *
 * @param currentTemp temperatura efectiva actual (°C)
 * @param setpoint    temperatura objetivo (°C)
 * @param p           parámetros del controlador
 * @param now         epoch ms (inyectable para testing)
 */
export function computeDesiredRelay(
  currentTemp: number,
  setpoint: number,
  p: TPIParams = DEFAULT_TPI,
  now: number = Date.now()
): TPIDecision {
  const error = setpoint - currentTemp;

  // Detectar cambios de setpoint para reaccionar de inmediato (no esperar al
  // límite de ciclo). NaN en la primera evaluación => no cuenta como cambio.
  const setpointChanged = !Number.isNaN(lastSetpoint) && setpoint !== lastSetpoint;
  const setpointLowered = setpointChanged && setpoint < lastSetpoint;
  lastSetpoint = setpoint;

  // --- Banda muerta (histéresis alrededor del setpoint) ---
  // Al alcanzar el setpoint, apagar y NO reencender hasta que la temperatura
  // baje `deadband` grados. Evita los pulsos cortos de mantenimiento a setpoint
  // (encendidos de 2 min cada 20 min con la temp ya en el objetivo).
  // Un cambio de setpoint reevalúa el latch desde cero: subir el objetivo
  // re-habilita la calefacción de inmediato; bajarlo por debajo de la temp
  // vuelve a apagar en esta misma evaluación.
  if (setpointChanged) satisfied = false;
  if (error <= 0) satisfied = true;                 // llegó (o superó) el setpoint
  else if (error >= p.deadband) satisfied = false;  // bajó lo suficiente: reencender

  if (satisfied) {
    integral = 0;
    currentDuty = 0;
    lastMode = 'off';
    return { on: false, duty: 0, integral, mode: 'off' };
  }

  let mode: TPIDecision['mode'];
  if (error >= p.proportionalBand) mode = 'continuous';
  else if (error <= -p.offMargin) mode = 'off';
  else mode = 'cycling';

  // Al entrar a la banda desde otro modo, o al cambiar el setpoint estando en
  // cycling, arrancar un ciclo fresco (recalcula el duty inmediatamente en vez
  // de esperar el límite de ciclo). Sin esto, bajar el setpoint dejaba la
  // caldera corriendo con el duty viejo —calculado para el error grande— hasta
  // cumplir el ciclo de 20 min.
  if (mode === 'cycling' && (lastMode !== 'cycling' || setpointChanged)) {
    cycleStart = 0;
  }
  lastMode = mode;

  // Al bajar el setpoint, descargar el integral acumulado: si no, el aporte
  // integral mantendría un duty > 0 (caldera prendida) aunque el error ya sea
  // ~0, sobrecalentando por encima del nuevo objetivo.
  if (setpointLowered) {
    integral = 0;
  }

  if (mode === 'continuous') {
    // Muy por debajo: caldera continua. Integral cargado para entrada suave.
    integral = p.integralMax;
    currentDuty = 1;
    return { on: true, duty: 1, integral, mode };
  }

  if (mode === 'off') {
    // Por encima del setpoint (con margen): apagar y descargar el integral.
    integral = 0;
    currentDuty = 0;
    return { on: false, duty: 0, integral, mode };
  }

  // Dentro de la banda proporcional: control por duty cycle.
  if (cycleStart === 0 || now - cycleStart >= p.cyclePeriodMs) {
    recomputeDuty(error, p);
    cycleStart = now;
  }

  const onMs = currentDuty * p.cyclePeriodMs;
  const on = now - cycleStart < onMs;
  return { on, duty: currentDuty, integral, mode };
}

/**
 * Snapshot del estado del controlador (para /status).
 */
export function getTPIState(): { duty: number; integral: number } {
  return { duty: currentDuty, integral };
}
