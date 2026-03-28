import React from "react";
import "./AgentPanel.css";

const AgentPanel = ({
  weatherData,
  routeAlongWeather = [],
  activeRouteInfo,
  newsData,
  trafficData,
  originConfigured,
}) => {
  let weatherActivity = "Awaiting coordinate data...";
  let weatherStatus = "Standby";
  let weatherHealth = 0;
  let weatherIcon = "🌪️";
  
  const getWeatherIcon = (mainCondition) => {
    switch (mainCondition?.toLowerCase()) {
      case 'clear': return '☀️';
      case 'clouds': return '☁️';
      case 'rain': return '🌧️';
      case 'drizzle': return '🌦️';
      case 'thunderstorm': return '⛈️';
      case 'snow': return '❄️';
      case 'mist':
      case 'fog':
      case 'haze': return '🌫️';
      default: return '🌤️';
    }
  };
  
  if (weatherData?.origin || weatherData?.destination) {
    weatherStatus = "Active";
    weatherHealth = 100;
    const getStr = (data, name) =>
      data
        ? `${name}: ${Math.round(data.main.temp)}°C, ${data.weather[0].main}`
        : `${name}: --`;
    let segments = `${getStr(weatherData.origin, "Origin")} | ${getStr(weatherData.destination, "Dest")}`;
    if (routeAlongWeather.length > 0) {
      const alongStr = routeAlongWeather
        .map((row) =>
          row.data
            ? `${row.data.name || "route pt"}: ${Math.round(row.data.main.temp)}°C, ${row.data.weather[0].main}`
            : null
        )
        .filter(Boolean)
        .join(" · ");
      if (alongStr) {
        segments += ` | Along selected route: ${alongStr}`;
      }
    }
    weatherActivity = segments;

    const condition =
      weatherData?.origin?.weather?.[0]?.main ||
      weatherData?.destination?.weather?.[0]?.main ||
      routeAlongWeather[0]?.data?.weather?.[0]?.main;
    weatherIcon = condition ? getWeatherIcon(condition) : "🌤️";
  }

  let newsActivity = "Awaiting coordinate data for targeted scan...";
  let newsStatus = "Standby";
  let newsHealth = 0;

  if (newsData) {
    if (newsData.status === "scanning") {
      newsActivity = "Aggregating local news endpoints...";
      newsStatus = "Scanning";
      newsHealth = 50;
    } else if (newsData.status === "clear") {
      newsActivity = "Local channels secure. No critical delays detected.";
      newsStatus = "Active";
      newsHealth = 100;
    } else {
      newsActivity = `LOCAL RISK: ${newsData.title}`;
      newsStatus = "Alert";
      newsHealth = 65; // Drop health factor due to conflict detection
    }
  }

  let trafficActivity = "Awaiting origin node...";
  let trafficStatus = "Standby";
  let trafficHealth = 0;

  if (originConfigured) {
    const routeLabel =
      activeRouteInfo && !activeRouteInfo.isOptimal
        ? "Selected alternate route"
        : activeRouteInfo
          ? "Selected fastest route"
          : "Selected route";
    if (trafficData.risk > 0) {
      trafficActivity =
        trafficData.risk >= 5
          ? `${routeLabel}: high risk / congestion (Lv ${trafficData.risk})`
          : `${routeLabel}: low routing risk (Lv ${trafficData.risk})`;
      trafficStatus = trafficData.status;
      trafficHealth = Math.max(10, 100 - trafficData.risk * 10);
    } else {
      trafficActivity = "Analyzing route exposure from your selection…";
      trafficStatus = "Analyzing";
      trafficHealth = 98;
    }
  }

  const agents = [
    {
      id: "ai-traffic",
      name: "Traffic Network AI",
      icon: "🚦",
      status: trafficStatus,
      color: "var(--accent-cyan)",
      activity: trafficActivity,
      health: trafficHealth
    },
    {
      id: "ai-weather",
      name: "Weather Predictor",
      icon: weatherIcon,
      status: weatherStatus,
      color: "var(--accent-purple)",
      activity: weatherActivity,
      health: weatherHealth
    },
    {
      id: "ai-geopolitics",
      name: "Local Risk Sentinel",
      icon: "📍",
      status: newsStatus,
      color: "var(--accent-red)",
      activity: newsActivity,
      health: newsHealth
    }
  ];

  return (
    <div className="agent-container glass-panel">
      <div className="panel-header">
        <h2>Autonomous Agents</h2>
        <span className="agent-count">3 Active</span>
      </div>
      
      <div className="agents-list">
        {agents.map((agent) => (
          <div className="agent-card" key={agent.id} style={{ '--agent-color': agent.color }}>
            <div className="agent-header">
              <div className="agent-icon" style={{ background: agent.color }}>
                {agent.icon}
              </div>
              <div className="agent-title">
                <h3>{agent.name}</h3>
                <div className="agent-status-badges">
                  <span className={`status-badge ${agent.status.toLowerCase()}`}>
                    {agent.status}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="agent-details">
              <p className="activity-text">{agent.activity}</p>
              
              <div className="health-bar-container">
                <div className="health-meta">
                  <span>Confidence Score</span>
                  <span>{agent.health}%</span>
                </div>
                <div className="health-track">
                  <div 
                    className="health-fill" 
                    style={{ 
                      width: `${agent.health}%`,
                      backgroundColor: agent.color,
                      boxShadow: `0 0 10px ${agent.color}`
                    }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AgentPanel;