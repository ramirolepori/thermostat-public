// Centralized validation functions for forms (scenes, temperature, etc.)
export function validateSceneName(name: string): string | null {
  if (!name || typeof name !== 'string') return 'El nombre es requerido';
  if (name.length < 3) return 'El nombre debe tener al menos 3 caracteres';
  if (!/^[\w\sáéíóúüñÁÉÍÓÚÜÑ-]+$/.test(name)) return 'El nombre contiene caracteres inválidos';
  return null;
}

export function validateTemperatureValue(temp: number): string | null {
  if (typeof temp !== 'number' || isNaN(temp)) return 'La temperatura debe ser un número';
  if (temp < 5 || temp > 30) return 'La temperatura debe estar entre 5°C y 30°C';
  return null;
}

export function validateHysteresisValue(h: number): string | null {
  if (typeof h !== 'number' || isNaN(h)) return 'La histéresis debe ser un número';
  if (h < 0.1 || h > 5) return 'La histéresis debe estar entre 0.1 y 5';
  return null;
}
