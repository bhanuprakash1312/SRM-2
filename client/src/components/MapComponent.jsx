import React, { useState, useEffect } from "react";
import polyline from "@mapbox/polyline";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

// 🔹 Component to handle map clicks
const LocationSelector = ({ origin, destination, setOrigin, setDestination }) => {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;

      if (!origin) {
        setOrigin([lat, lng]);
      } else if (!destination) {
        setDestination([lat, lng]);
      } else {
        // Reset flow
        setOrigin([lat, lng]);
        setDestination(null);
      }
    },
  });

  return null;
};

const MapComponent = ({ forcedAlternative, origin, setOrigin, destination, setDestination, weatherData, onTrafficUpdate }) => {
  const [routes, setRoutes] = useState([]);
  const [bestRouteIndex, setBestRouteIndex] = useState(null);
  const [loading, setLoading] = useState(false);

  // 🔹 Risk logic
  const calculateRisk = (route) => {
    const { distance, duration } = route.summary;

    let risk = 1;
    risk += duration / 3600;
    risk += distance / 50000;

    return Math.min(Math.round(risk), 10);
  };

  useEffect(() => {
    const fetchRoutes = async () => {
      if (!origin || !destination) return;

      setLoading(true);

      const apiKey = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjQxY2IxYjgwMDcwNTRmZTBiOGIzMjY2MGQ5NGI3ZGNhIiwiaCI6Im11cm11cjY0In0=";
      const url = "https://api.openrouteservice.org/v2/directions/driving-car";

      // 🔹 Calculate approx distance to avoid ORS 150km limit for alternative routing
      const getDistanceKm = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) ** 2;
        return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
      };

      const estimatedDistance = getDistanceKm(origin[0], origin[1], destination[0], destination[1]);

      let body = {
        coordinates: [
          [origin[1], origin[0]],
          [destination[1], destination[0]],
        ],
        radiuses: [5000, 5000],
        instructions: false,
      };

      // OpenRouteService Restricts alternative routes to distance < 150km. Using 100km to be safe.
      if (estimatedDistance < 100) {
        body.alternative_routes = {
          target_count: 2,
          share_factor: 0.6,
        };
      }

      try {
        let response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: apiKey,
          },
          body: JSON.stringify(body),
        });

        let data = await response.json();

        // Fallback retry if we still get a 2004 limit error from ORS
        if (data.error && data.error.code === 2004 && body.alternative_routes) {
            delete body.alternative_routes;
            response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: apiKey,
              },
              body: JSON.stringify(body),
            });
            data = await response.json();
        }

        if (!data.routes) {
          setRoutes([]);
          return;
        }

        const fetchedRoutes = data.routes.map((route) => {
          const decoded = polyline.decode(route.geometry);

          return {
            geometry: decoded, // already [lat, lng]
            summary: route.summary,
            risk: calculateRisk(route),
          };
        });

        setRoutes(fetchedRoutes);
      } catch (err) {
        console.error("Fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchRoutes();
  }, [origin, destination]);

  // 🔹 Find best route
  const optimalIndex = routes.length > 0 ? routes.reduce((bestIdx, route, idx, arr) =>
    route.summary.distance < arr[bestIdx].summary.distance ? idx : bestIdx
  , 0) : null;

  useEffect(() => {
    if (routes.length > 0) {
      if (forcedAlternative && routes.length > 1) {
        // Switch to an alternative route that isn't the primary 'best' one
        const optimalIndex = routes.reduce((bestIdx, route, idx, arr) =>
          route.summary.distance < arr[bestIdx].summary.distance ? idx : bestIdx
        , 0);
        
        const altIndex = routes.findIndex((r, idx) => idx !== optimalIndex);
        setBestRouteIndex(altIndex !== -1 ? altIndex : 0);
        
        if (onTrafficUpdate) onTrafficUpdate(routes[altIndex !== -1 ? altIndex : 0].risk);
      } else {
        const optimalIndex = routes.reduce((bestIdx, route, idx, arr) =>
          route.summary.distance < arr[bestIdx].summary.distance ? idx : bestIdx
        , 0);

        setBestRouteIndex(optimalIndex);
        if (onTrafficUpdate) onTrafficUpdate(routes[optimalIndex].risk);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, forcedAlternative]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      {/* 🔹 Overlay UI */}
      <div style={{ 
        position: "absolute", 
        top: 20, 
        left: "50%", 
        transform: "translateX(-50%)", 
        zIndex: 1000,
        background: "rgba(10, 12, 18, 0.8)",
        padding: "10px 20px",
        borderRadius: "20px",
        border: "1px solid rgba(0,240,255,0.3)",
        boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
        backdropFilter: "blur(10px)",
        color: "var(--text-main)",
        fontSize: "13px",
        display: "flex",
        gap: "10px",
        alignItems: "center",
        pointerEvents: "none"
      }}>
        <span style={{color: "var(--accent-cyan)", animation: "pulse 2s infinite"}}>🎯</span>
        {loading ? "Analyzing global networks..." : "Click to set Origin and Destination nodes"}
      </div>

      <MapContainer
        center={[20.5937, 78.9629]}
        zoom={5}
        style={{ height: "100%", width: "100%", background: "#0d0f14", zIndex: 1 }}
        zoomControl={false}
      >
        <TileLayer 
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          className="map-tiles"
        />

        {/* 🔹 Click handler */}
        <LocationSelector
          origin={origin}
          destination={destination}
          setOrigin={setOrigin}
          setDestination={setDestination}
        />

        {/* 🔹 Routes */}
        {routes.map((route, index) => {
          const isBest = index === bestRouteIndex;
          const isOptimal = index === optimalIndex;
          const routeColor = isOptimal ? "#00ff66" : "#ff3366"; // Green for optimal, Red for alternative
          return (
            <React.Fragment key={index}>
              {/* Glow effect for selected route */}
              {isBest && (
                <Polyline
                  positions={route.geometry}
                  pathOptions={{
                    color: routeColor,
                    weight: 10,
                    opacity: 0.3,
                  }}
                />
              )}
              {/* Actual line */}
              <Polyline
                positions={route.geometry}
                eventHandlers={{
                  click: () => setBestRouteIndex(index),
                }}
                pathOptions={{
                  color: routeColor,
                  weight: isBest ? 5 : 3,
                  opacity: isBest ? 1 : 0.6,
                  dashArray: isBest ? null : "8, 12",
                }}
              />
            </React.Fragment>
          );
        })}

        {/* 🔹 Markers */}
        {origin && (
          <Marker position={origin}>
            <Popup>
              <div style={{color: "#000"}}>
                <b>Origin Node</b><br/>
                {weatherData?.origin ? (
                  <span>
                    Condition: {weatherData.origin.weather[0].main} <br/>
                    Temp: {Math.round(weatherData.origin.main.temp)}°C
                  </span>
                ) : (
                  "Loading weather..."
                )}
              </div>
            </Popup>
          </Marker>
        )}

        {destination && (
          <Marker position={destination}>
            <Popup>
              <div style={{color: "#000"}}>
                <b>Destination Node</b><br/>
                {weatherData?.destination ? (
                  <span>
                    Condition: {weatherData.destination.weather[0].main} <br/>
                    Temp: {Math.round(weatherData.destination.main.temp)}°C
                  </span>
                ) : (
                  "Awaiting payload"
                )}
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
      
      {/* Floating Route Info if calculated */}
      {routes.length > 0 && (
         <div style={{
           position: "absolute",
           bottom: 30,
           left: 30,
           zIndex: 1000,
           display: "flex",
           gap: "15px",
           maxWidth: "100%",
           overflowX: "auto",
           padding: "5px"
         }}>
           {routes.map((route, index) => {
             const isBest = index === bestRouteIndex;
             const isOptimal = index === optimalIndex;
             const routeColor = isOptimal ? "#00ff66" : "#ff3366";
             const glowColor = isOptimal ? "rgba(0, 255, 102, 0.2)" : "rgba(255, 51, 102, 0.2)";
             const bgColor = isOptimal ? "rgba(0, 255, 102, 0.1)" : "rgba(255, 51, 102, 0.1)";

             return (
               <div key={index} 
                 onClick={() => setBestRouteIndex(index)}
                 style={{
                 background: isBest ? bgColor : "rgba(25, 30, 41, 0.8)",
                 border: `1px solid ${isBest ? routeColor : (isOptimal ? "rgba(0,255,102,0.4)" : "rgba(255,51,102,0.4)")}`,
                 borderRadius: "12px",
                 padding: "16px",
                 backdropFilter: "blur(10px)",
                 boxShadow: isBest ? `0 0 20px ${glowColor}` : "0 8px 32px rgba(0,0,0,0.4)",
                 minWidth: "200px",
                 cursor: "pointer",
                 transition: "all 0.3s ease"
               }}>
                 <div style={{fontSize: "12px", textTransform:"uppercase", color: routeColor, marginBottom: "8px", fontWeight: "bold", display: "flex", justifyContent: "space-between"}}>
                   <span>{isOptimal ? "Optimal Path" : `Alternative`}</span>
                   {isBest && <span style={{fontSize: "10px", padding: "2px 6px", background: routeColor, color: "#000", borderRadius: "10px"}}>ACTIVE</span>}
                 </div>
                 <div style={{color: "var(--text-main)", fontSize: "20px", fontWeight: "bold", fontFamily: "var(--font-heading)"}}>
                   {(route.summary.distance / 1000).toFixed(0)} <span style={{fontSize: "12px", color: "var(--text-muted)"}}>km</span>
                 </div>
                 <div style={{display: "flex", justifyContent:"space-between", marginTop: "10px", fontSize: "12px", color: "var(--text-muted)", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "8px", gap: "20px"}}>
                   <span>{(route.summary.duration / 60 / 60).toFixed(1)} hrs</span>
                   <span style={{color: route.risk >= 5 ? "var(--accent-red)" : "var(--accent-yellow)"}}>
                     Risk Lv {route.risk}
                   </span>
                 </div>
               </div>
             )
           })}
         </div>
      )}
    </div>
  );
};

export default MapComponent;