import React from "react";
import "./AlertPanel.css";

const AlertPanel = ({ alerts, onExecuteReroute }) => {
  return (
    <div className="alert-container glass-panel">
      <div className="alert-header">
        <h2>Risk Detection</h2>
        <span className="pulse-icon">⚠️</span>
      </div>

      <div className="alerts-list">
        {alerts.map((alert) => (
          <div className={`alert-card ${alert.severity}`} key={alert.id}>
            <div className="alert-card-header">
              <span className="alert-type">{alert.type}</span>
              <span className="alert-time">{alert.timestamp}</span>
            </div>
            <p className="alert-message">{alert.message}</p>
            {alert.severity === "critical" && !alert.resolved && (
              <button 
                className="re-route-btn" 
                onClick={() => onExecuteReroute(alert.id)}
              >
                <span className="btn-icon">⚡</span> Execute Reroute
              </button>
            )}
            {alert.resolved && (
              <div className="resolved-badge">✓ Optimal Path Secured</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlertPanel;
