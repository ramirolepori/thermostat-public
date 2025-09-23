
import React from "react"
import { useState } from "react"
import { Clock, Calendar, Thermometer, Plus, Trash2 } from "lucide-react"
import "../styles/Automations.css"

type AutomationType = "schedule" | "temperature" | "presence"
type Automation = {
  id: number
  name: string
  type: AutomationType
  enabled: boolean
  details: string
}

const initialAutomations: Automation[] = [
  {
    id: 1,
    name: "Morning Warmup",
    type: "schedule",
    enabled: true,
    details: "Weekdays, 6:30 AM - Set to 22°C",
  },
  {
    id: 2,
    name: "Energy Saving",
    type: "temperature",
    enabled: true,
    details: "When below 15°C outside - Optimize heating",
  },
  {
    id: 3,
    name: "Away Mode",
    type: "presence",
    enabled: false,
    details: "When no one is home - Set to 18°C",
  },
]

const Automations = () => {
  const [automations, setAutomations] = useState<Automation[]>(initialAutomations)
  const [isCreating, setIsCreating] = useState(false)
  const [newAutomation, setNewAutomation] = useState<Partial<Automation>>({
    name: "",
    type: "schedule",
    enabled: true,
    details: "",
  })

  const getTypeIcon = (type: AutomationType) => {
    switch (type) {
      case "schedule":
        return <Clock className="automation-icon schedule" />
      case "temperature":
        return <Thermometer className="automation-icon temperature" />
      case "presence":
        return <Calendar className="automation-icon presence" />
    }
  }

  const toggleAutomation = (id: number) => {
    setAutomations(
      automations.map((automation) =>
        automation.id === id ? { ...automation, enabled: !automation.enabled } : automation,
      ),
    )
  }

  const deleteAutomation = (id: number) => {
    setAutomations(automations.filter((automation) => automation.id !== id))
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setNewAutomation({
      ...newAutomation,
      [name]: value,
    })
  }

  const saveNewAutomation = () => {
    if (!newAutomation.name || !newAutomation.details) return

    const automation: Automation = {
      id: Date.now(),
      name: newAutomation.name,
      type: newAutomation.type as AutomationType,
      enabled: newAutomation.enabled || true,
      details: newAutomation.details,
    }

    setAutomations([...automations, automation])
    setNewAutomation({
      name: "",
      type: "schedule",
      enabled: true,
      details: "",
    })
    setIsCreating(false)
  }

  return (
    <div className="automations-container">
      <div className="automations">
        <div className="automations-header">
          <h2>Automations</h2>
          <p className="subtitle">Create rules to automate your thermostat</p>
        </div>

        <div className="automations-list">
          {automations.map((automation) => (
            <div key={automation.id} className="automation-card">
              <div className="automation-content">
                {getTypeIcon(automation.type)}
                <div className="automation-info">
                  <h3>{automation.name}</h3>
                  <p>{automation.details}</p>
                </div>
              </div>

              <div className="automation-actions">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={automation.enabled}
                    onChange={() => toggleAutomation(automation.id)}
                  />
                  <span className="toggle-slider"></span>
                </label>
                <button className="delete-automation" onClick={() => deleteAutomation(automation.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {isCreating ? (
          <div className="new-automation-form">
            <h3>New Automation</h3>

            <div className="form-group">
              <label htmlFor="name">Name</label>
              <input
                type="text"
                id="name"
                name="name"
                value={newAutomation.name}
                onChange={handleInputChange}
                placeholder="Automation name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="type">Type</label>
              <select id="type" name="type" value={newAutomation.type} onChange={handleInputChange}>
                <option value="schedule">Schedule</option>
                <option value="temperature">Temperature</option>
                <option value="presence">Presence</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="details">Details</label>
              <textarea
                id="details"
                name="details"
                value={newAutomation.details}
                onChange={handleInputChange}
                placeholder="Describe what this automation does"
              />
            </div>

            <div className="form-actions">
              <button className="save-button" onClick={saveNewAutomation}>
                Save Automation
              </button>
              <button className="cancel-button" onClick={() => setIsCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="add-automation-button" onClick={() => setIsCreating(true)}>
            <Plus size={20} />
            Add New Automation
          </button>
        )}
      </div>
    </div>
  )
}

export default React.memo(Automations);
