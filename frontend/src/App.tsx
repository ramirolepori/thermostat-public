import React, { useState, lazy, Suspense } from "react"
import { Thermometer, Zap } from "lucide-react"
import "./App.css"

// Cargar componentes usando lazy loading para mejorar el tiempo de carga inicial
const Thermostat = lazy(() => import("./components/Thermostat"))
const Automations = lazy(() => import("./components/Automations"))

// Componente de carga simple para mostrar mientras se cargan los componentes
const LoadingFallback = () => (
  <div className="loading-container">
    <div className="loading-spinner"></div>
    <p>Cargando...</p>
  </div>
)

function App() {
  const [currentScreen, setCurrentScreen] = useState<"thermostat" | "automations">("thermostat")

  return (
    <div className="app">
      <header>
        <h1>Smart Thermostat</h1>
      </header>
      
      <main>
        <Suspense fallback={<LoadingFallback />}>
          {currentScreen === "thermostat" ? <Thermostat /> : <Automations />}
        </Suspense>
      </main>
      
      <nav className="navigation">
        <button
          className={`nav-button ${currentScreen === "thermostat" ? "active" : ""}`}
          onClick={() => setCurrentScreen("thermostat")}
        >
          <Thermometer size={24} />
          <span>Thermostat</span>
        </button>
        <button
          className={`nav-button ${currentScreen === "automations" ? "active" : ""}`}
          onClick={() => setCurrentScreen("automations")}
        >
          <Zap size={24} />
          <span>Automations</span>
        </button>
      </nav>
      
      <footer>
        <p>Smart Home Control System</p>
      </footer>
    </div>
  )
}

export default App
