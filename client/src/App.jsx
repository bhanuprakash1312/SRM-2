import React, { useState, useEffect, useCallback } from "react";
import { Toaster } from "react-hot-toast";
import MapComponent from "./components/MapComponent";
import AgentPanel from "./components/AgentPanel";
import AlertPanel from "./components/AlertPanel";
import WeatherForecastPanel from "./components/WeatherForecastPanel";
import "./App.css";

function App() {
  const [forcedAlternative, setForcedAlternative] = useState(false);
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [weatherData, setWeatherData] = useState({ origin: null, destination: null });
  const [routeSamplePoints, setRouteSamplePoints] = useState([]);
  const [routeAlongWeather, setRouteAlongWeather] = useState([]);
  const [activeRouteInfo, setActiveRouteInfo] = useState(null);
  const [weatherForecast, setWeatherForecast] = useState({ origin: null, destination: null });
  const [newsData, setNewsData] = useState(null);
  const [trafficData, setTrafficData] = useState({ risk: 0, status: "Standby" });
  const [activeAlerts, setActiveAlerts] = useState([]);

  const handleExecuteReroute = (id) => {
    setForcedAlternative(true);
    setActiveAlerts((prev) =>
      prev.map((alert) =>
        alert.id === id
          ? {
            ...alert,
            resolved: true,
            severity: "info",
            message: "Reroute executed successfully. Path secured and risks mitigated.",
            type: "Risk Mitigated",
          }
          : alert
      )
    );
  };

  const fetchWeather = async (lat, lon, type) => {
    try {
      const apiKey = "68991b161965035f444f0af5e443d4c0";
      
      // Current Weather
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.cod === 200) {
        setWeatherData((prev) => ({ ...prev, [type]: data }));
      }

      // 5-Day Forecast
      const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
      const forecastRes = await fetch(forecastUrl);
      const forecastData = await forecastRes.json();
      if (forecastData && forecastData.list) {
        setWeatherForecast(prev => ({ ...prev, [type]: forecastData }));
      }
    } catch (err) {
      console.error("Weather fetch error", err);
    }
  };

  const handleActiveRouteChange = useCallback((info) => {
    setActiveAlerts((prev) =>
      prev.filter((a) => !String(a.type).includes("Along route"))
    );
    if (!info?.samplePoints?.length) {
      setRouteSamplePoints([]);
      setActiveRouteInfo(null);
      return;
    }
    setActiveRouteInfo({
      index: info.index,
      totalRoutes: info.totalRoutes,
      isOptimal: info.isOptimal,
      risk: info.risk,
      distanceM: info.summary?.distance,
      durationS: info.summary?.duration,
    });
    setRouteSamplePoints(info.samplePoints);
  }, []);

  const handleUserRouteSelected = useCallback(() => {
    setForcedAlternative(false);
  }, []);

  useEffect(() => {
    if (!routeSamplePoints.length) {
      setRouteAlongWeather([]);
      return;
    }
    const apiKey = "d4dacbc0d7a74e15c38a5e54c1e990da";
    let cancelled = false;

    (async () => {
      const rows = await Promise.all(
        routeSamplePoints.map(async ([lat, lon], i) => {
          try {
            const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.cod !== 200) return null;
            return {
              key: `along-${i}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
              lat,
              lon,
              data,
            };
          } catch {
            return null;
          }
        })
      );
      if (!cancelled) {
        setRouteAlongWeather(rows.filter(Boolean));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeSamplePoints]);

  useEffect(() => {
    if (origin) {
      fetchWeather(origin[0], origin[1], "origin");
      setForcedAlternative(false); // Reset forced alternative on new origin
    }
  }, [origin]);

  useEffect(() => {
    if (destination) {
      fetchWeather(destination[0], destination[1], "destination");
      setForcedAlternative(false); // Reset forced alternative on new destination
    }
  }, [destination]);

  // 🌩️ Dynamic Weather Alert Engine (endpoints + samples along the selected route — same idea as route-aware navigation)
  useEffect(() => {
    const checkWeatherRisk = (data, locName) => {
      if (!data) return;
      const condition = data.weather[0].main.toLowerCase();
      const severeConditions = ["thunderstorm", "snow", "extreme", "tornado", "hurricane", "rain"];
      const isSevere = severeConditions.includes(condition) || data.main.temp > 40 || data.main.temp < -5;
      
      if (isSevere) {
        setActiveAlerts((prev) => {
          if (prev.some((a) => a.type === `Severe Weather: ${locName}`)) return prev;
          return [
            {
              id: `${locName}-${Date.now()}`,
              type: `Severe Weather: ${locName}`,
              severity: "critical",
              message: `DANGER: Severe ${data.weather[0].main} at ${locName}. Temp: ${data.main.temp}°C. Affects your selected route.`,
              timestamp: "Just now",
              resolved: false,
            },
            ...prev,
          ];
        });
      }
    };

    checkWeatherRisk(weatherData.origin, "Origin");
    checkWeatherRisk(weatherData.destination, "Destination");
    routeAlongWeather.forEach((row, idx) => {
      const label = row.data?.name
        ? `Along route — ${row.data.name}`
        : `Along route (segment ${idx + 1})`;
      checkWeatherRisk(row.data, label);
    });
  }, [weatherData, routeAlongWeather]);

  // 🚦 Traffic / delay for whichever route is selected (updates when you pick an alternate, like Google Maps)
  const handleTrafficUpdate = useCallback((riskLevel) => {
    setTrafficData({ 
      risk: riskLevel, 
      status: riskLevel >= 5 ? "Alert" : "Active" 
    });

    if (riskLevel >= 5) {
       setActiveAlerts(prev => {
         if (prev.some(a => a.type.includes("Route Congestion"))) return prev;
         return [{
           id: Date.now() + Math.random(),
           type: "Route Congestion Risk",
           severity: riskLevel >= 8 ? "critical" : "warning",
           message: `High risk parameter (Lv ${riskLevel}) detected on primary route indicating delays.`,
           timestamp: "Just now",
           resolved: false
         }, ...prev];
       });
    }
  }, []);

  useEffect(() => {
    // 🌍 Localized news: origin, destination, and cities along the selected route (reruns when route path changes)
    const fetchLocationNews = async () => {
      const locNames = [];
      const pushUnique = (name) => {
        if (!name || locNames.includes(name)) return;
        locNames.push(name);
      };
      if (weatherData.origin?.name) pushUnique(weatherData.origin.name);
      if (weatherData.destination?.name) pushUnique(weatherData.destination.name);
      routeAlongWeather.forEach((row) => {
        if (row.data?.name) pushUnique(row.data.name);
      });

      if (locNames.length === 0) {
        setNewsData(null);
        return;
      }

      setNewsData({ status: "scanning" });

      try {
        // Fetch targeted Google News RSS for each location
        const fetchPromises = locNames.map(async loc => {
           // Query: "CityName AND (war OR conflict OR strike OR protest OR storm OR disruption)"
           const query = `"${loc}" AND (war OR conflict OR strike OR protest OR storm OR disruption)`;
           const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
           return fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`)
             .then(res => res.json());
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("News fetch timeout")), 5000)
        );

        const results = await Promise.race([Promise.allSettled(fetchPromises), timeoutPromise]);

        const allNews = [];
        if (Array.isArray(results)) {
          for (const result of results) {
            if (
              result.status === "fulfilled" &&
              result.value.status === "ok" &&
              result.value.items
            ) {
              allNews.push(...result.value.items);
            }
          }
        }

        if (allNews.length > 0) {
          const detectedRisk = {
            title: allNews[0].title,
            description: allNews[0].description,
          };
          setNewsData(detectedRisk);

          setActiveAlerts((prev) => {
            const rest = prev.filter(
              (a) => a.type !== "LIVE: Localized News Risk"
            );
            return [
              {
                id: `news-${Date.now()}`,
                type: "LIVE: Localized News Risk",
                severity: "critical",
                message: `BREAKING along your corridor (${locNames.join(" / ")}): ${detectedRisk.title} — consider adjusting the selected route.`,
                timestamp: "Just now",
                resolved: false,
              },
              ...rest,
            ];
          });
        } else {
          setNewsData({ status: "clear" });
          setActiveAlerts((prev) =>
            prev.filter((a) => a.type !== "LIVE: Localized News Risk")
          );
        }
      } catch (err) {
        console.error("Local news fetch error or timeout:", err);
        setNewsData({ status: "clear" });
      }
    };

    fetchLocationNews();
  }, [weatherData.origin, weatherData.destination, routeAlongWeather]);

  return (
    <div className="app-container">
      <header className="dashboard-header">
        <h1>
          <span className="logo-icon">⬡</span> AI <span>Supply Chain</span>
        </h1>
        <div className="status">
          <div className="status-dot"></div>
          AI System Online
        </div>
      </header>

      <aside className="sidebar">
        <AgentPanel
          weatherData={weatherData}
          routeAlongWeather={routeAlongWeather}
          activeRouteInfo={activeRouteInfo}
          newsData={newsData}
          trafficData={trafficData}
          originConfigured={!!origin}
        />
      </aside>

      <main className="map-area">
        <MapComponent
          forcedAlternative={forcedAlternative}
          origin={origin}
          setOrigin={setOrigin}
          destination={destination}
          setDestination={setDestination}
          weatherData={weatherData}
          onTrafficUpdate={handleTrafficUpdate}
          onActiveRouteChange={handleActiveRouteChange}
          onUserRouteSelected={handleUserRouteSelected}
        />
      </main>

      <aside className="right-panel">
        <AlertPanel 
          alerts={activeAlerts} 
          onExecuteReroute={handleExecuteReroute} 
          hasAlternativeRoutes={activeRouteInfo?.totalRoutes > 1} 
        />
        <WeatherForecastPanel forecast={weatherForecast} />
      </aside>

      <Toaster
        position="top-center"
        containerStyle={{ top: "4.5rem" }}
        toastOptions={{
          duration: 4500,
          style: {
            background: "rgba(10, 12, 18, 0.95)",
            color: "#e8eaef",
            border: "1px solid rgba(0, 240, 255, 0.25)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
          },
          error: {
            iconTheme: { primary: "#ff3366", secondary: "#0d0f14" },
          },
        }}
      />
    </div>
  );
}

export default App;
