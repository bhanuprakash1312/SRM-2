import React, { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import polyline from "@mapbox/polyline";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  CircleMarker,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const ORS_API_KEY =
  "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjQxY2IxYjgwMDcwNTRmZTBiOGIzMjY2MGQ5NGI3ZGNhIiwiaCI6Im11cm11cjY0In0=";
const ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

const EARTH_RADIUS_M = 6371000;
/** Off-road distance from your GPS fix to the active polyline before we recalculate (Google Maps–style). */
const ROUTE_DEVIATION_THRESHOLD_M = 90;
const REROUTE_COOLDOWN_MS = 12000;
const NEAR_DESTINATION_M = 70;
const MAX_GPS_ACCURACY_M = 180;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLng = r(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function pointToPolylineDistanceMeters(lat, lng, geometry) {
  if (!geometry?.length || geometry.length < 2) return Infinity;
  let min = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const mPerLng = 111320 * cosLat;
  const mPerLat = 111320;
  for (let i = 0; i < geometry.length - 1; i++) {
    const [lat1, lng1] = geometry[i];
    const [lat2, lng2] = geometry[i + 1];
    const ax = (lng1 - lng) * mPerLng;
    const ay = (lat1 - lat) * mPerLat;
    const bx = (lng2 - lng) * mPerLng;
    const by = (lat2 - lat) * mPerLat;
    const abx = bx - ax;
    const aby = by - ay;
    const ab2 = abx * abx + aby * aby;
    let t = ab2 === 0 ? 0 : (-(ax * abx + ay * aby)) / ab2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const d = Math.hypot(cx, cy);
    if (d < min) min = d;
  }
  return min;
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getPerturbedMidpoint(lat1, lon1, lat2, lon2, offsetKm) {
  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const len = Math.sqrt(dLat * dLat + dLon * dLon);
  if (len === 0) return [midLat, midLon];
  const nLat = -dLon / len;
  const nLon = dLat / len;
  // Account for longitude shrinking
  const offsetDegLat = offsetKm / 111.0;
  const offsetDegLon = (offsetKm / 111.0) / Math.max(0.1, Math.cos((midLat * Math.PI) / 180));
  return [midLat + nLat * offsetDegLat, midLon + nLon * offsetDegLon];
}

async function fetchORSRoutes(pointsLatLng, calculateRisk) {
  if (!pointsLatLng?.length || pointsLatLng.length < 2) return null;

  const estimatedDistance = getDistanceKm(
    pointsLatLng[0][0],
    pointsLatLng[0][1],
    pointsLatLng[pointsLatLng.length - 1][0],
    pointsLatLng[pointsLatLng.length - 1][1]
  );

  let body = {
    coordinates: pointsLatLng.map(([la, ln]) => [ln, la]),
    radiuses: pointsLatLng.map(() => 5000),
    instructions: false,
  };

  if (pointsLatLng.length === 2) {
    body.alternative_routes = {
      target_count: 3,
      share_factor: 0.6,
    };
  }

  let response = await fetch(ORS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: ORS_API_KEY,
    },
    body: JSON.stringify(body),
  });

  let data = await response.json();

  if (data.error && data.error.code === 2004 && body.alternative_routes) {
    delete body.alternative_routes;
    response = await fetch(ORS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify(body),
    });
    data = await response.json();

    // 🔹 SYNTHETIC ALTERNATIVE FOR LONG DISTANCES
    if (data.routes && data.routes.length > 0 && pointsLatLng.length === 2) {
      const [oLat, oLon] = pointsLatLng[0];
      const [dLat, dLon] = pointsLatLng[1];
      
      // Calculate a waypoint offset by ~150km to force a different path
      const [mLat, mLon] = getPerturbedMidpoint(oLat, oLon, dLat, dLon, 150);

      const altBody = {
        coordinates: [
          [oLon, oLat],
          [mLon, mLat],
          [dLon, dLat]
        ],
        radiuses: [-1, -1, -1], // unrestricted snapping
        instructions: false,
      };

      try {
        const altRes = await fetch(ORS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: ORS_API_KEY,
          },
          body: JSON.stringify(altBody)
        });
        const altData = await altRes.json();
        
        // If successful, push it to the main routes returned!
        if (altData.routes && altData.routes.length > 0) {
           data.routes.push(altData.routes[0]);
        }
      } catch (err) {
        console.error("Failed to fetch synthetic alternative", err);
      }
    }
  }

  // Artificial alternative pathway for large routes where ORS native fails
  if (data.routes && data.routes.length === 1 && pointsLatLng.length === 2 && estimatedDistance >= 100) {
    try {
      const srcLat = pointsLatLng[0][0];
      const srcLon = pointsLatLng[0][1];
      const dstLat = pointsLatLng[1][0];
      const dstLon = pointsLatLng[1][1];

      const midLat = (srcLat + dstLat) / 2;
      const midLon = (srcLon + dstLon) / 2;
      
      const dLat = dstLat - srcLat;
      const dLon = dstLon - srcLon;

      const latRad = midLat * (Math.PI / 180);
      const cosLat = Math.cos(latRad) || 1;

      const perpLat = -dLon * cosLat;
      const perpLon = dLat / cosLat;
      
      const offsetScale = 0.15; // 15% perpendicular deviation 
      const wpLat = midLat + perpLat * offsetScale;
      const wpLon = midLon + perpLon * offsetScale;

      const altBody = {
        coordinates: [
          [srcLon, srcLat],
          [wpLon, wpLat],
          [dstLon, dstLat]
        ],
        instructions: false,
      };

      const altResponse = await fetch(ORS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ORS_API_KEY,
        },
        body: JSON.stringify(altBody),
      });

      const altData = await altResponse.json();
      if (altData.routes && altData.routes.length > 0) {
        data.routes.push(altData.routes[0]);
      }
    } catch (err) {
      console.error("Failed fetching artificial alternative", err);
    }
  }

  if (!data.routes) return null;

  return data.routes.map((route) => {
    const decoded = polyline.decode(route.geometry);
    return {
      geometry: decoded,
      summary: route.summary,
      risk: calculateRisk(route),
    };
  });
}

/**
 * BigDataCloud client reverse-geocode (browser CORS, no key).
 * Nominatim often returns { error: "Unable to geocode" } for oceans, which we previously treated as land.
 */
function isWaterBigDataCloud(d) {
  if (!d || typeof d !== "object") return false;
  const loc = (d.locality || "").toLowerCase();
  if (
    /\b(lake|sea|ocean|gulf|bay|strait|channel|lagoon|reservoir)\b/.test(loc)
  ) {
    return true;
  }

  const inf = d.localityInfo?.informative || [];
  for (const item of inf) {
    const desc = (item.description || "").toLowerCase();
    const name = (item.name || "").toLowerCase();
    if (/\b(lake|reservoir)\b/.test(desc) || /\b(lake|reservoir)\b/.test(name)) {
      return true;
    }
  }

  if (d.countryCode && String(d.countryCode).length === 2) return false;
  if (d.city && String(d.city).trim()) return false;

  for (const item of inf) {
    const desc = (item.description || "").toLowerCase();
    const name = (item.name || "").toLowerCase();
    if (
      /\b(sea|ocean|gulf|bay|strait|channel)\b/.test(name) &&
      /\b(ocean|sea|marginal|water)\b/.test(desc)
    ) {
      return true;
    }
  }

  return false;
}

async function isPointOverWater(lat, lng) {
  const url =
    "https://api.bigdatacloud.net/data/reverse-geocode-client" +
    `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=en`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return false;
    const data = await res.json();
    return isWaterBigDataCloud(data);
  } catch (err) {
    console.error("Land/water check failed:", err);
    return false;
  }
}

// 🔹 Component to handle map clicks
const LocationSelector = ({ origin, destination, setOrigin, setDestination }) => {
  useMapEvents({
    async click(e) {
      const { lat, lng } = e.latlng;

      if (await isPointOverWater(lat, lng)) {
        toast.error(
          "This point appears to be on water. Please keep the location on land.",
          { id: "water-location" }
        );
        return;
      }

      if (!origin) {
        setOrigin([lat, lng]);
      } else if (!destination) {
        setDestination([lat, lng]);
      } else {
        setOrigin([lat, lng]);
        setDestination(null);
      }
    },
  });

  return null;
};

function samplePolylinePoints(geometry, sampleCount) {
  if (!geometry?.length) return [];
  const last = geometry.length - 1;
  if (last <= 0) return [[geometry[0][0], geometry[0][1]]];
  const out = [];
  for (let i = 1; i <= sampleCount; i++) {
    const idx = Math.min(last, Math.round((i / (sampleCount + 1)) * last));
    const p = geometry[idx];
    out.push([p[0], p[1]]);
  }
  return out;
}

const MapComponent = ({
  forcedAlternative,
  origin,
  setOrigin,
  destination,
  setDestination,
  weatherData,
  onTrafficUpdate,
  onActiveRouteChange,
  onUserRouteSelected,
}) => {
  const [routes, setRoutes] = useState([]);
  const [bestRouteIndex, setBestRouteIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [liveNavPosition, setLiveNavPosition] = useState(null);
  const [navStatus, setNavStatus] = useState("off");
  const [autoRerouteEnabled, setAutoRerouteEnabled] = useState(true);

  const lastRerouteAtRef = useRef(0);
  const rerouteInFlightRef = useRef(false);
  const rerouteGenerationRef = useRef(0);
  const watchIdRef = useRef(null);
  const lastAccuracyRef = useRef(null);
  const userWasOnRouteRef = useRef(false);

  useEffect(() => {
    userWasOnRouteRef.current = false;
  }, [origin, destination]);

  const calculateRisk = useCallback((route) => {
    const { distance, duration } = route.summary;
    let risk = 1;
    risk += duration / 3600;
    risk += distance / 50000;
    return Math.min(Math.round(risk), 10);
  }, []);

  useEffect(() => {
    const loadPlannedRoutes = async () => {
      if (!origin || !destination) {
        setRoutes([]);
        setBestRouteIndex(null);
        setLiveNavPosition(null);
        return;
      }

      setLoading(true);
      try {
        const fetched = await fetchORSRoutes(
          [
            [origin[0], origin[1]],
            [destination[0], destination[1]],
          ],
          calculateRisk
        );
        setRoutes(fetched || []);
      } catch (err) {
        console.error("Fetch error:", err);
        setRoutes([]);
      } finally {
        setLoading(false);
      }
    };

    loadPlannedRoutes();
  }, [origin, destination, calculateRisk]);

  const runAdaptiveReroute = useCallback(
    async (fromLatLng) => {
      if (!destination || rerouteInFlightRef.current) return;
      const destLatLng = [destination[0], destination[1]];
      if (haversineMeters(fromLatLng[0], fromLatLng[1], destLatLng[0], destLatLng[1]) < NEAR_DESTINATION_M) {
        return;
      }

      rerouteInFlightRef.current = true;
      const gen = ++rerouteGenerationRef.current;
      try {
        const fetched = await fetchORSRoutes(
          [
            [fromLatLng[0], fromLatLng[1]],
            destLatLng,
          ],
          calculateRisk
        );
        if (gen !== rerouteGenerationRef.current || !fetched?.length) return;

        onUserRouteSelected?.();
        userWasOnRouteRef.current = true;
        setRoutes(fetched);
        toast(
          "You left the suggested route — directions updated from your current location. Destination unchanged.",
          {
            id: "nav-adaptive-reroute",
            duration: 5000,
            icon: "🧭",
            style: {
              border: "1px solid rgba(0, 240, 255, 0.35)",
            },
          }
        );
      } catch (e) {
        console.error("Adaptive reroute failed:", e);
        toast.error("Could not update route from your position. Try again in a moment.", {
          id: "nav-reroute-fail",
        });
      } finally {
        rerouteInFlightRef.current = false;
      }
    },
    [destination, calculateRisk, onUserRouteSelected]
  );

  useEffect(() => {
    if (!origin || !destination) {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setNavStatus("off");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNavStatus("unsupported");
      return;
    }
    if (!window.isSecureContext) {
      setNavStatus("unsupported");
      return;
    }

    setNavStatus("active");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        lastAccuracyRef.current = pos.coords.accuracy ?? null;
        setLiveNavPosition([pos.coords.latitude, pos.coords.longitude]);
      },
      () => {
        setNavStatus("denied");
        setLiveNavPosition(null);
        toast.error(
          "Enable location permission so the map can adapt your route when you leave the suggested path.",
          { id: "nav-denied" }
        );
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [origin, destination]);

  useEffect(() => {
    if (
      !autoRerouteEnabled ||
      navStatus !== "active" ||
      !liveNavPosition ||
      !destination ||
      !routes.length ||
      bestRouteIndex == null ||
      bestRouteIndex >= routes.length
    ) {
      return;
    }

    if (
      lastAccuracyRef.current != null &&
      lastAccuracyRef.current > MAX_GPS_ACCURACY_M
    ) {
      return;
    }

    const route = routes[bestRouteIndex];
    const geom = route.geometry;
    const distToLine = pointToPolylineDistanceMeters(
      liveNavPosition[0],
      liveNavPosition[1],
      geom
    );
    const distToDest = haversineMeters(
      liveNavPosition[0],
      liveNavPosition[1],
      destination[0],
      destination[1]
    );

    if (distToDest < NEAR_DESTINATION_M) return;

    if (distToLine < ROUTE_DEVIATION_THRESHOLD_M * 1.15) {
      userWasOnRouteRef.current = true;
    }
    if (!userWasOnRouteRef.current) return;

    if (distToLine < ROUTE_DEVIATION_THRESHOLD_M) return;
    if (Date.now() - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return;

    lastRerouteAtRef.current = Date.now();
    runAdaptiveReroute(liveNavPosition);
  }, [
    autoRerouteEnabled,
    navStatus,
    liveNavPosition,
    destination,
    routes,
    bestRouteIndex,
    runAdaptiveReroute,
  ]);

  // 🔹 Find best route
  const optimalIndex = routes.length > 0 ? routes.reduce((bestIdx, route, idx, arr) =>
    route.summary.distance < arr[bestIdx].summary.distance ? idx : bestIdx
  , 0) : null;

  useEffect(() => {
    if (routes.length > 0) {
      if (forcedAlternative && routes.length > 1) {
        const optimalIdx = routes.reduce(
          (bestIdx, route, idx, arr) =>
            route.summary.distance < arr[bestIdx].summary.distance ? idx : bestIdx,
          0
        );
        const altIdx = routes.findIndex((_, idx) => idx !== optimalIdx);
        setBestRouteIndex(altIdx !== -1 ? altIdx : 0);
      } else {
        const optimalIdx = routes.reduce(
          (bestIdx, route, idx, arr) =>
            route.summary.distance < arr[bestIdx].summary.distance ? idx : bestIdx,
          0
        );
        setBestRouteIndex(optimalIdx);
      }
    }
  }, [routes, forcedAlternative]);

  useEffect(() => {
    if (!routes.length) {
      onActiveRouteChange?.(null);
      onTrafficUpdate?.(0);
      return;
    }
    if (bestRouteIndex == null || bestRouteIndex >= routes.length) {
      return;
    }
    const route = routes[bestRouteIndex];
    const optimalIdx = routes.reduce(
      (bestIdx, r, idx, arr) =>
        r.summary.distance < arr[bestIdx].summary.distance ? idx : bestIdx,
      0
    );
    const isOptimal = bestRouteIndex === optimalIdx;
    onTrafficUpdate?.(route.risk);
    const samples = samplePolylinePoints(route.geometry, 3);
    onActiveRouteChange?.({
      index: bestRouteIndex,
      totalRoutes: routes.length,
      isOptimal,
      risk: route.risk,
      summary: route.summary,
      samplePoints: samples,
    });
  }, [bestRouteIndex, routes, onTrafficUpdate, onActiveRouteChange]);

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
        {loading
          ? "Analyzing global networks..."
          : routes.length > 0
            ? "Green = fastest route. Tap lines/cards to switch. With GPS on, leaving the active path re-routes you to the same destination."
            : "Click to set Origin and Destination nodes"}
      </div>

      {origin && destination && routes.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "7.5rem",
            right: "1.25rem",
            zIndex: 1001,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "8px",
            maxWidth: "240px",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setAutoRerouteEnabled((v) => !v);
              toast(
                !autoRerouteEnabled
                  ? "Auto reroute ON — deviations will refresh directions to your destination."
                  : "Auto reroute OFF — path stays fixed until you change it manually.",
                { id: "nav-toggle" }
              );
            }}
            style={{
              cursor: "pointer",
              padding: "8px 14px",
              borderRadius: "10px",
              border: `1px solid ${autoRerouteEnabled ? "rgba(30,144,255,0.5)" : "rgba(255,255,255,0.2)"}`,
              background: autoRerouteEnabled
                ? "rgba(30, 144, 255, 0.15)"
                : "rgba(25, 30, 41, 0.9)",
              color: "var(--text-main)",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            GPS reroute: {autoRerouteEnabled ? "On" : "Off"}
          </button>
          <div
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              textAlign: "right",
              lineHeight: 1.35,
              background: "rgba(10, 12, 18, 0.75)",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {navStatus === "active" && liveNavPosition && (
              <span style={{ color: "#7ec8ff" }}>● Live position</span>
            )}
            {navStatus === "active" && !liveNavPosition && <span>Acquiring GPS…</span>}
            {navStatus === "denied" && (
              <span style={{ color: "var(--accent-red)" }}>Location blocked — allow access to adapt routes.</span>
            )}
            {navStatus === "unsupported" && (
              <span>GPS not available (needs secure https or localhost).</span>
            )}
          </div>
        </div>
      )}

      {routes.length > 1 &&
        optimalIndex != null &&
        bestRouteIndex != null &&
        bestRouteIndex !== optimalIndex && (
          <button
            type="button"
            onClick={() => {
              onUserRouteSelected?.();
              setBestRouteIndex(optimalIndex);
              toast.success("Now following the fastest route. Alerts and corridor info will update.", {
                id: "route-fastest",
                duration: 3500,
              });
            }}
            style={{
              position: "absolute",
              top: "4.75rem",
              right: "1.25rem",
              zIndex: 1001,
              cursor: "pointer",
              padding: "10px 16px",
              borderRadius: "12px",
              border: "1px solid rgba(0, 255, 102, 0.45)",
              background: "rgba(0, 255, 102, 0.12)",
              color: "#b8ffd4",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "inherit",
              boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
              backdropFilter: "blur(10px)",
            }}
          >
            Use fastest route
          </button>
        )}

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
                  click: () => {
                    onUserRouteSelected?.();
                    if (
                      index === optimalIndex &&
                      bestRouteIndex != null &&
                      bestRouteIndex !== optimalIndex
                    ) {
                      toast.success(
                        "Now following the fastest route. Alerts and corridor info will update.",
                        { id: "route-fastest", duration: 3500 }
                      );
                    }
                    setBestRouteIndex(index);
                  },
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

        {liveNavPosition && navStatus === "active" && routes.length > 0 && (
          <CircleMarker
            center={liveNavPosition}
            radius={9}
            pathOptions={{
              color: "#0d3a5c",
              fillColor: "#38b6ff",
              fillOpacity: 1,
              weight: 3,
            }}
          >
            <Popup>
              <div style={{ color: "#000" }}>
                <b>Your position (GPS)</b>
                <br />
                Active path updates here if you leave the suggested route.
              </div>
            </Popup>
          </CircleMarker>
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
                 onClick={() => {
                   onUserRouteSelected?.();
                   if (
                     index === optimalIndex &&
                     bestRouteIndex != null &&
                     bestRouteIndex !== optimalIndex
                   ) {
                     toast.success(
                       "Now following the fastest route. Alerts and corridor info will update.",
                       { id: "route-fastest", duration: 3500 }
                     );
                   }
                   setBestRouteIndex(index);
                 }}
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
                   <span>
                     {isOptimal ? "Fastest route" : `Route ${index + 1}`}
                     {!isOptimal && <span style={{ fontWeight: 400, opacity: 0.85 }}> (alternate)</span>}
                   </span>
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