import { initializeMqtt, stopMqtt, getMqttServiceState } from './services/mqtt';

console.log('🧪 Prueba de integración MQTT');

// Prueba básica de importación
console.log('✅ Módulo MQTT importado correctamente');

// Obtener estado inicial
const initialState = getMqttServiceState();
console.log('📊 Estado inicial:', JSON.stringify(initialState, null, 2));

console.log('🎯 Prueba completada - El módulo MQTT está listo para usar');
