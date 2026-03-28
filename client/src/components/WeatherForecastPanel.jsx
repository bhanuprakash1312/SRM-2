import React from "react";
import "./WeatherForecastPanel.css";

const WeatherForecastPanel = ({ forecast }) => {
  if (!forecast?.origin && !forecast?.destination) {
    return null;
  }

  // Helper to extract ~1 reading per day (e.g., at 12:00:00) from the 3-hour list
  const getDailyForecast = (list) => {
    if (!list) return [];
    
    const dailyData = [];
    const seenDays = new Set();
    
    // Prefer mid-day readings
    for (const item of list) {
        const date = new Date(item.dt * 1000);
        const dayString = date.toLocaleDateString();
        
        if (!seenDays.has(dayString) && item.dt_txt.includes("12:00:00")) {
            seenDays.add(dayString);
            dailyData.push(item);
        }
    }
    
    // Fallback if we don't have exactly 12:00:00 for some days
    if (dailyData.length < 5) {
        for (const item of list) {
            const date = new Date(item.dt * 1000);
            const dayString = date.toLocaleDateString();
            if (!seenDays.has(dayString)) {
                seenDays.add(dayString);
                dailyData.push(item);
            }
            if (dailyData.length === 5) break;
        }
    }

    return dailyData.slice(0, 5).sort((a,b) => a.dt - b.dt);
  };

  const originForecast = getDailyForecast(forecast.origin?.list);
  const destinationForecast = getDailyForecast(forecast.destination?.list);

  const renderForecast = (title, dailyForecast) => {
    if (!dailyForecast || dailyForecast.length === 0) return null;

    return (
      <div className="forecast-section">
        <h3>{title} Forecast</h3>
        <div className="forecast-cards">
          {dailyForecast.map((day, idx) => {
            const date = new Date(day.dt * 1000);
            const dayName = date.toLocaleDateString("en-US", { weekday: 'short' });
            const temp = Math.round(day.main.temp);
            const condition = day.weather[0].main;
            const iconUrl = `https://openweathermap.org/img/wn/${day.weather[0].icon}.png`;

            return (
              <div key={idx} className="forecast-card">
                <div className="forecast-day">{dayName}</div>
                <img src={iconUrl} alt={condition} title={condition} className="forecast-icon" />
                <div className="forecast-temp">{temp}°C</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="weather-forecast-panel glass-panel">
      <div className="panel-header">
        <h2>5-Day Forecast</h2>
      </div>
      <div className="forecast-container-scroll">
        {forecast.origin && renderForecast("Origin", originForecast)}
        {forecast.destination && renderForecast("Destination", destinationForecast)}
      </div>
    </div>
  );
};

export default WeatherForecastPanel;
