import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Settings,
  CheckSquare,
  Menu,
  Shield,
  Truck,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  MapPin,
  Search,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, ZoomControl, Circle } from 'react-leaflet';
import L from 'leaflet';
import './App.css';
import logoImg from './assets/logo.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createColoredIcon = (colorName) =>
  new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${colorName}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

const depotIcon = createColoredIcon('black');
const destIcon = createColoredIcon('red');
const userIcon = createColoredIcon('blue');
const platoonIcons = [createColoredIcon('green'), createColoredIcon('orange'), createColoredIcon('violet')];

const WEATHER_FACTORS = {
  clear: { energyBoost: 1.0, timeBoost: 1.0 },
  rain: { energyBoost: 1.12, timeBoost: 1.14 },
  wind: { energyBoost: 1.08, timeBoost: 1.07 },
  storm: { energyBoost: 1.2, timeBoost: 1.24 },
};

const TRAFFIC_FACTORS = {
  light: { energyBoost: 0.96, timeBoost: 0.94 },
  moderate: { energyBoost: 1.0, timeBoost: 1.0 },
  heavy: { energyBoost: 1.18, timeBoost: 1.28 },
};

const SPEED_PRESETS = [
  { label: 'Urban 45', value: 45 },
  { label: 'Balanced 65', value: 65 },
  { label: 'Express 85', value: 85 },
];

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const toFixedNumber = (value, digits = 2) => Number.parseFloat(value.toFixed(digits));

const formatDuration = (minutes) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '--';
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  const hrs = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return `${hrs}h ${mins}m`;
};

const formatEnergy = (kwh) => {
  if (!Number.isFinite(kwh) || kwh <= 0) return '--';
  return `${kwh.toFixed(1)} kWh`;
};

const formatComputation = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

const normalizeCoord = (coord) => {
  if (!coord) return null;

  if (Array.isArray(coord) && coord.length >= 2) {
    const a = Number(coord[0]);
    const b = Number(coord[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [a, b];
    if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return [b, a];
    return null;
  }

  const lat = Number(coord.lat ?? coord.latitude);
  const lng = Number(coord.lng ?? coord.lon ?? coord.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];

  return null;
};

const normalizePath = (coords) => {
  if (!Array.isArray(coords)) return [];
  return coords.map(normalizeCoord).filter(Boolean);
};

const haversineKm = ([lat1, lng1], [lat2, lng2]) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
};

const estimateDistanceKm = (path) => {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineKm(path[i - 1], path[i]);
  }
  return total;
};

const interpolateRoute = (origin, destination, segments = 18) => {
  const safeSegments = clampNumber(segments, 4, 50);
  return Array.from({ length: safeSegments + 1 }, (_, index) => {
    const t = index / safeSegments;
    return [
      origin[0] + (destination[0] - origin[0]) * t,
      origin[1] + (destination[1] - origin[1]) * t,
    ];
  });
};

const createOffsetRoute = (basePath, vehicleIndex) => {
  const phase = vehicleIndex * 0.6;
  const magnitude = 0.00035 * (vehicleIndex + 1);
  return basePath.map(([lat, lng], pointIndex) => {
    const wave = Math.sin(pointIndex * 0.55 + phase) * magnitude;
    return [lat + wave, lng - wave * 0.75];
  });
};

const getTrafficLabel = (trafficIndex) => {
  if (trafficIndex >= 70) return 'High';
  if (trafficIndex >= 40) return 'Moderate';
  return 'Low';
};

const buildEnvironmentLayers = (path) => {
  if (!Array.isArray(path) || path.length === 0) return [];

  const step = Math.max(1, Math.floor(path.length / 6));
  const sampled = path.filter((_, idx) => idx % step === 0).slice(0, 6);

  return sampled.map((point, index) => {
    const trafficIndex = clampNumber(18 + index * 14, 5, 95);
    const slopePercent = clampNumber(2 + index * 2.2, 1, 16);
    const trafficColor =
      trafficIndex >= 70 ? '#ef4444' : trafficIndex >= 40 ? '#f59e0b' : '#22c55e';

    return {
      id: `layer-${index}`,
      center: point,
      radius: 220 + slopePercent * 20,
      trafficIndex,
      slopePercent: toFixedNumber(slopePercent, 1),
      trafficColor,
      trafficLabel: getTrafficLabel(trafficIndex),
    };
  });
};

const buildTradeoffSamples = (distanceKm, weather, traffic, platooningEnabled) => {
  const weatherFactor = WEATHER_FACTORS[weather] || WEATHER_FACTORS.clear;
  const trafficFactor = TRAFFIC_FACTORS[traffic] || TRAFFIC_FACTORS.moderate;
  const platoonFactor = platooningEnabled ? 0.89 : 1;
  const speeds = [35, 45, 55, 65, 75, 85, 95];

  return speeds.map((speedKph) => {
    const rollingLoss = 0.15 + speedKph * 0.0045;
    const aeroLoss = speedKph * speedKph * 0.00062;

    const keashEnergy =
      distanceKm * rollingLoss * aeroLoss * weatherFactor.energyBoost * trafficFactor.energyBoost * platoonFactor;
    const baselineEnergy =
      distanceKm *
      (0.23 + speedKph * 0.0062 + speedKph * speedKph * 0.00075) *
      weatherFactor.energyBoost *
      trafficFactor.energyBoost;
    const journeyMinutes =
      (distanceKm / speedKph) * 60 * weatherFactor.timeBoost * trafficFactor.timeBoost;

    return {
      speedKph,
      keashEnergy: toFixedNumber(keashEnergy),
      baselineEnergy: toFixedNumber(baselineEnergy),
      journeyMinutes: toFixedNumber(journeyMinutes),
    };
  });
};

const getNearestSample = (samples, speedKph) => {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  return samples.reduce((closest, sample) =>
    Math.abs(sample.speedKph - speedKph) < Math.abs(closest.speedKph - speedKph) ? sample : closest,
  );
};

const fetchRoadRoute = async (origin, destination) => {
  const start = `${origin[1]},${origin[0]}`;
  const end = `${destination[1]},${destination[0]}`;
  const routeResponse = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson&steps=false&alternatives=false`,
  );

  if (!routeResponse.ok) {
    throw new Error(`OSRM route request failed with status ${routeResponse.status}`);
  }

  const routeData = await routeResponse.json();
  if (routeData.code !== 'Ok' || !Array.isArray(routeData.routes) || routeData.routes.length === 0) {
    throw new Error('Road route not available for this destination');
  }

  const bestRoute = routeData.routes[0];
  const coords = bestRoute?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error('Road geometry payload was empty');
  }

  const path = coords
    .map((point) => (Array.isArray(point) && point.length >= 2 ? [Number(point[1]), Number(point[0])] : null))
    .filter(Boolean);

  if (path.length < 2) {
    throw new Error('Road geometry could not be decoded');
  }

  return {
    path,
    distanceKm: Number(bestRoute.distance || 0) / 1000,
    durationMinutes: Number(bestRoute.duration || 0) / 60,
  };
};

const normalizeKeashResponse = (data, context) => {
  const backendPath = normalizePath(data?.route?.path ?? data?.route?.polyline ?? data?.polyline ?? data?.path ?? []);
  const mainPath = backendPath.length > 1 ? backendPath : interpolateRoute(context.origin, context.destination, 20);

  const parsedDistance = Number(data?.metrics?.distanceKm ?? data?.route?.distanceKm);
  const distanceKm =
    Number.isFinite(parsedDistance) && parsedDistance > 0
      ? parsedDistance
      : Math.max(estimateDistanceKm(mainPath), 1);

  const tradeoffSamples = buildTradeoffSamples(
    distanceKm,
    context.weather,
    context.traffic,
    context.platooning.enabled,
  );
  const selectedSample = getNearestSample(tradeoffSamples, context.speedKph) || tradeoffSamples[0];

  const parsedEnergy = Number(data?.metrics?.totalEnergyKwh ?? data?.metrics?.energyKwh);
  const totalEnergyKwh =
    Number.isFinite(parsedEnergy) && parsedEnergy > 0 ? parsedEnergy : selectedSample.keashEnergy;

  const parsedTime = Number(data?.metrics?.journeyTimeMin ?? data?.metrics?.journeyMinutes);
  const journeyMinutes =
    Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : selectedSample.journeyMinutes;

  const parsedEmissions = Number(data?.metrics?.emissionsProxyKg ?? data?.metrics?.emissionsKg);
  const emissionsProxyKg =
    Number.isFinite(parsedEmissions) && parsedEmissions > 0 ? parsedEmissions : totalEnergyKwh * 0.21;

  const parsedComputation = Number(data?.metrics?.computationCostMs ?? data?.metrics?.computeMs);
  const computationCostMs =
    Number.isFinite(parsedComputation) && parsedComputation > 0
      ? parsedComputation
      : Math.round(130 + mainPath.length * 9 + (context.platooning.enabled ? 110 : 40));

  const parsedBaseline = Number(data?.baseline?.energyKwh ?? data?.baselineEnergyKwh);
  const baselineEnergyKwh =
    Number.isFinite(parsedBaseline) && parsedBaseline > 0 ? parsedBaseline : selectedSample.baselineEnergy;

  const energyDeltaPercent =
    baselineEnergyKwh > 0 ? ((baselineEnergyKwh - totalEnergyKwh) / baselineEnergyKwh) * 100 : 0;

  const routeFeasibility =
    data?.metrics?.routeFeasibility ??
    (context.weather === 'storm' && context.traffic === 'heavy' ? 'Marginal' : 'Feasible');

  const backendEnv = Array.isArray(data?.environment?.layers)
    ? data.environment.layers
    : Array.isArray(data?.environmentLayers)
      ? data.environmentLayers
      : [];

  const environmentLayers =
    backendEnv
      .map((layer, index) => {
        const center = normalizeCoord(layer.center ?? layer.point ?? layer.coordinates);
        if (!center) return null;
        const trafficIndex = clampNumber(Number(layer.trafficIndex ?? layer.traffic ?? 45), 0, 100);
        const slopePercent = clampNumber(Number(layer.slopePercent ?? layer.slope ?? 4), 0, 25);

        return {
          id: layer.id ?? `backend-layer-${index}`,
          center,
          radius: clampNumber(Number(layer.radius ?? 280), 120, 700),
          trafficIndex,
          slopePercent: toFixedNumber(slopePercent, 1),
          trafficColor: trafficIndex >= 70 ? '#ef4444' : trafficIndex >= 40 ? '#f59e0b' : '#22c55e',
          trafficLabel: getTrafficLabel(trafficIndex),
        };
      })
      .filter(Boolean);

  const routeLayers = environmentLayers.length > 0 ? environmentLayers : buildEnvironmentLayers(mainPath);

  let platoonRoutes = [];
  if (context.platooning.enabled) {
    const backendRoutes = Array.isArray(data?.platooning?.routes)
      ? data.platooning.routes.map(normalizePath).filter((path) => path.length > 1)
      : [];

    if (backendRoutes.length >= context.platooning.vehicleCount) {
      platoonRoutes = backendRoutes.slice(0, context.platooning.vehicleCount);
    } else if (backendRoutes.length > 0) {
      const missing = context.platooning.vehicleCount - backendRoutes.length;
      platoonRoutes = [
        ...backendRoutes,
        ...Array.from({ length: missing }, (_, idx) =>
          createOffsetRoute(mainPath, idx + backendRoutes.length + 1),
        ),
      ];
    } else {
      platoonRoutes = Array.from({ length: context.platooning.vehicleCount }, (_, idx) =>
        idx === 0 ? mainPath : createOffsetRoute(mainPath, idx + 1),
      );
    }
  }

  const platoonMarkers = (context.platooning.enabled ? platoonRoutes : [mainPath])
    .map((path, idx) => {
      if (!path || path.length === 0) return null;
      const markerIndex = Math.min(path.length - 1, Math.floor(path.length * (0.22 + idx * 0.12)));
      return {
        id: `vehicle-${idx}`,
        vehicle: idx + 1,
        position: path[markerIndex],
      };
    })
    .filter(Boolean);

  const destinationLabel = data?.route?.destinationLabel ?? context.destinationName;
  const routeLabel = data?.route?.label ?? `Current Location → ${destinationLabel}`;

  return {
    mainPath,
    platoonRoutes,
    platoonMarkers,
    environmentLayers: routeLayers,
    distanceKm,
    summary: {
      route: routeLabel,
      destination: destinationLabel,
      journeyTime: formatDuration(journeyMinutes),
      totalEnergy: formatEnergy(totalEnergyKwh),
      routeFeasibility,
      emissionsProxy: `${emissionsProxyKg.toFixed(1)} kgCO2e`,
      computationCost: formatComputation(computationCostMs),
      baselineEnergy: formatEnergy(baselineEnergyKwh),
      deltaVsBaseline: `${Math.abs(energyDeltaPercent).toFixed(1)}% ${
        energyDeltaPercent >= 0 ? 'lower' : 'higher'
      } than baseline`,
    },
    fitPoints: [context.origin, context.destination, ...mainPath],
  };
};

function MapController({ center, bounds }) {
  const map = useMap();

  useEffect(() => {
    if (Array.isArray(bounds) && bounds.length > 1) {
      map.fitBounds(bounds, { padding: [45, 45] });
      return;
    }

    if (center) {
      map.flyTo(center, 14, { duration: 1.5 });
    }
  }, [center, bounds, map]);

  return null;
}

function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activePopup, setActivePopup] = useState(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);

  const [userLocation, setUserLocation] = useState(null);
  const [destinationCoords, setDestinationCoords] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [platoonRoutes, setPlatoonRoutes] = useState([]);
  const [platoonMarkers, setPlatoonMarkers] = useState([]);
  const [environmentLayers, setEnvironmentLayers] = useState([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState(32);
  const [mapBounds, setMapBounds] = useState(null);

  const [showDestModal, setShowDestModal] = useState(false);
  const [destQuery, setDestQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isSuggestionLocked, setIsSuggestionLocked] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isRouting, setIsRouting] = useState(false);

  const [activeTab, setActiveTab] = useState('optimize');

  const [speedKph, setSpeedKph] = useState(65);
  const [weatherProfile, setWeatherProfile] = useState('clear');
  const [trafficProfile, setTrafficProfile] = useState('moderate');
  const [platooningEnabled, setPlatooningEnabled] = useState(false);
  const [platoonVehicleCount, setPlatoonVehicleCount] = useState(3);
  const [platoonSpacingMeters, setPlatoonSpacingMeters] = useState(24);
  const [backendStatus, setBackendStatus] = useState('Awaiting first solve');

  const [routeSummary, setRouteSummary] = useState({
    route: 'No active route',
    destination: '--',
    journeyTime: '--',
    totalEnergy: '--',
    routeFeasibility: 'Pending',
    emissionsProxy: '--',
    computationCost: '--',
    baselineEnergy: '--',
    deltaVsBaseline: '--',
  });

  const tradeoffSamples = useMemo(
    () => buildTradeoffSamples(routeDistanceKm, weatherProfile, trafficProfile, platooningEnabled),
    [routeDistanceKm, weatherProfile, trafficProfile, platooningEnabled],
  );

  const selectedSample = useMemo(
    () => getNearestSample(tradeoffSamples, speedKph),
    [tradeoffSamples, speedKph],
  );

  const activePlatoonSize = platooningEnabled ? platoonVehicleCount : 1;

  const scrollToSection = (event, id) => {
    event.preventDefault();
    setActiveTab(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setIsMobileMenuOpen(false);
    };

    window.addEventListener('resize', handleResize);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = [position.coords.latitude, position.coords.longitude];
          setUserLocation(coords);
          setTimeout(() => setShowDestModal(true), 1200);
        },
        (error) => console.error('Error getting user location:', error),
        { enableHighAccuracy: true },
      );
    }

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const trimmedQuery = destQuery.trim();
    if (isSuggestionLocked || trimmedQuery.length < 3) {
      setSuggestions([]);
      return;
    }

    let isCancelled = false;
    const debounce = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmedQuery)}&limit=5`,
        );
        const data = await response.json();
        if (!isCancelled) {
          setSuggestions(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error(error);
        }
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    }, 450);

    return () => {
      isCancelled = true;
      clearTimeout(debounce);
    };
  }, [destQuery, isSuggestionLocked]);

  const handleDestinationInputChange = (event) => {
    setIsSuggestionLocked(false);
    setDestQuery(event.target.value);
  };

  const handleSuggestionSelect = (value) => {
    setDestQuery(value);
    setSuggestions([]);
    setIsSearching(false);
    setIsSuggestionLocked(true);
  };

  const closeDestinationModal = () => {
    setSuggestions([]);
    setIsSearching(false);
    setShowDestModal(false);
  };

  const applyRoutingResult = (normalizedResult) => {
    setRoutePath(normalizedResult.mainPath);
    setPlatoonRoutes(normalizedResult.platoonRoutes);
    setPlatoonMarkers(normalizedResult.platoonMarkers);
    setEnvironmentLayers(normalizedResult.environmentLayers);
    setRouteDistanceKm(normalizedResult.distanceKm);
    setRouteSummary(normalizedResult.summary);
    setMapBounds(normalizedResult.fitPoints);
  };

  const handleSetDestination = async (event) => {
    event.preventDefault();
    if (!destQuery.trim() || !userLocation) return;

    setSuggestions([]);
    setIsSearching(false);
    setIsSuggestionLocked(true);
    setIsRouting(true);
    try {
      const geoResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destQuery)}&limit=1`,
      );
      const geoData = await geoResponse.json();

      if (!Array.isArray(geoData) || geoData.length === 0) {
        alert('Could not find that destination.');
        setIsRouting(false);
        return;
      }

      const target = [Number.parseFloat(geoData[0].lat), Number.parseFloat(geoData[0].lon)];
      const destinationName = geoData[0].display_name.split(',')[0].trim();
      setDestinationCoords(target);

      const roadRoute = await fetchRoadRoute(userLocation, target);
      const normalized = normalizeKeashResponse(
        {
          route: {
            path: roadRoute.path,
            distanceKm: roadRoute.distanceKm,
            destinationLabel: destinationName,
            label: `Current Location → ${destinationName}`,
          },
          metrics: {
            journeyTimeMin: roadRoute.durationMinutes,
          },
        },
        {
        origin: userLocation,
        destination: target,
        destinationName,
        speedKph,
        weather: weatherProfile,
        traffic: trafficProfile,
        platooning: {
          enabled: platooningEnabled,
          vehicleCount: activePlatoonSize,
        },
      },
      );

      applyRoutingResult(normalized);
      setBackendStatus('Road route solved');
    } catch (error) {
      console.error(error);
      setBackendStatus('Road route unavailable');
      alert('Could not fetch a road-based route. Please try another destination.');
    } finally {
      setIsRouting(false);
      setShowDestModal(false);
      setBottomSheetExpanded(true);
    }
  };

  const togglePopup = (popupType) => {
    if (activePopup === popupType) setActivePopup(null);
    else setActivePopup(popupType);
  };

  const renderSidebarContent = () => (
    <>
      <div id="optimize" className="card">
        <div className="card-header">
          <h2 className="card-title">KEASH Control Surface</h2>
        </div>
        <div className="card-body">
          <div
            className="preset-pills"
            style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.2rem', flexWrap: 'wrap' }}
          >
            {SPEED_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={`preset-pill ${speedKph === preset.value ? 'active' : ''}`}
                onClick={() => setSpeedKph(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="control-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="control-label" style={{ marginBottom: 0 }}>
                Speed Priority
              </label>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--success)' }}>
                {speedKph} km/h
              </span>
            </div>
            <input
              type="range"
              min="30"
              max="110"
              step="1"
              value={speedKph}
              onChange={(e) => setSpeedKph(Number(e.target.value))}
              className="slider-green modern-slider"
            />
          </div>

          <div className="control-group" style={{ marginTop: '1.2rem' }}>
            <label className="control-label">Weather Scenario</label>
            <select
              className="control-select"
              value={weatherProfile}
              onChange={(e) => setWeatherProfile(e.target.value)}
            >
              <option value="clear">Clear</option>
              <option value="rain">Rain</option>
              <option value="wind">Wind</option>
              <option value="storm">Storm</option>
            </select>
          </div>

          <div className="control-group" style={{ marginTop: '1rem' }}>
            <label className="control-label">Traffic Scenario</label>
            <select
              className="control-select"
              value={trafficProfile}
              onChange={(e) => setTrafficProfile(e.target.value)}
            >
              <option value="light">Light</option>
              <option value="moderate">Moderate</option>
              <option value="heavy">Heavy</option>
            </select>
          </div>

          <div className="control-group" style={{ marginTop: '1.2rem' }}>
            <div className="toggle-row">
              <label className="control-label" style={{ marginBottom: 0 }}>
                Cooperative Platooning
              </label>
              <button
                type="button"
                className={`platoon-toggle ${platooningEnabled ? 'enabled' : ''}`}
                onClick={() => setPlatooningEnabled((prev) => !prev)}
              >
                {platooningEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            {platooningEnabled && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <span className="info-label">Vehicle Count</span>
                  <span className="info-value bold">{platoonVehicleCount}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="8"
                  value={platoonVehicleCount}
                  onChange={(e) => setPlatoonVehicleCount(Number(e.target.value))}
                  className="slider-blue modern-slider"
                />

                <div
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', marginTop: '0.8rem' }}
                >
                  <span className="info-label">Spacing</span>
                  <span className="info-value bold">{platoonSpacingMeters} m</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="60"
                  value={platoonSpacingMeters}
                  onChange={(e) => setPlatoonSpacingMeters(Number(e.target.value))}
                  className="slider-teal modern-slider"
                />
              </>
            )}
          </div>

          <div className="projection-pill">
            <span>Projected KEASH Energy</span>
            <strong>{selectedSample ? formatEnergy(selectedSample.keashEnergy) : '--'}</strong>
          </div>
          <div className="projection-pill" style={{ marginTop: '0.6rem' }}>
            <span>Projected Journey Time</span>
            <strong>{selectedSample ? formatDuration(selectedSample.journeyMinutes) : '--'}</strong>
          </div>

          <button className="btn-primary btn-green" onClick={() => setShowDestModal(true)}>
            Compute KEASH Route
          </button>
          <p className="mini-note">Payload sent: origin, destination, speed, weather, traffic, platooning.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div
          className="card-header"
          style={{ paddingBottom: '0.75rem', borderBottom: '1px solid rgba(226, 232, 240, 0.5)' }}
        >
          <h2 className="card-title">Route Summary</h2>
        </div>
        <div className="card-body right-sidebar-body" style={{ paddingTop: '1rem' }}>
          <div className="info-row" style={{ alignItems: 'center' }}>
            <span className="info-label">Route:</span>
            <span
              className="info-value bold route-path"
              style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}
            >
              {routeSummary.route.split('→').map((part, index, arr) => (
                <React.Fragment key={index}>
                  <span>{part.trim()}</span>
                  {index < arr.length - 1 && (
                    <span style={{ color: '#cbd5e1', fontSize: '0.9em' }}>→</span>
                  )}
                </React.Fragment>
              ))}
            </span>
          </div>

          <div className="summary-grid">
            <div className="info-row">
              <span className="info-label">Destination</span>
              <span className="info-value bold">{routeSummary.destination}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Journey Time</span>
              <span className="info-value bold">{routeSummary.journeyTime}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Total Energy</span>
              <span className="info-value bold">{routeSummary.totalEnergy}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Route Feasibility</span>
              <span className="info-value bold">{routeSummary.routeFeasibility}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Emissions Proxy</span>
              <span className="info-value bold">{routeSummary.emissionsProxy}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Computation Cost</span>
              <span className="info-value bold">{routeSummary.computationCost}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Baseline Energy</span>
              <span className="info-value bold">{routeSummary.baselineEnergy}</span>
            </div>
            <div className="info-row">
              <span className="info-label">KEASH Gain</span>
              <span className="info-value bold" style={{ color: 'var(--success)' }}>
                {routeSummary.deltaVsBaseline}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div id="analytics" className="card" style={{ marginTop: '1.5rem' }}>
        <div
          className="card-header"
          style={{ paddingBottom: '0.75rem', borderBottom: '1px solid rgba(226, 232, 240, 0.5)' }}
        >
          <h2 className="card-title">Energy vs Time Tradeoff</h2>
        </div>
        <div className="card-body right-sidebar-body" style={{ paddingTop: '1rem' }}>
          <div className="chart-wrapper" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tradeoffSamples} margin={{ top: 12, right: 8, left: 4, bottom: 12 }}>
                <XAxis dataKey="speedKph" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis yAxisId="energy" tick={{ fill: '#64748b', fontSize: 12 }} width={42} />
                <YAxis
                  yAxisId="time"
                  orientation="right"
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  width={42}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'Journey Minutes') return [`${value} min`, name];
                    return [`${value} kWh`, name];
                  }}
                  labelFormatter={(label) => `Speed ${label} km/h`}
                />
                <ReferenceLine
                  x={selectedSample?.speedKph ?? speedKph}
                  stroke="#0ea5e9"
                  strokeDasharray="4 4"
                />
                <Line
                  yAxisId="energy"
                  type="monotone"
                  dataKey="keashEnergy"
                  name="KEASH Energy"
                  stroke="#10b981"
                  strokeWidth={2.4}
                  dot={false}
                />
                <Line
                  yAxisId="energy"
                  type="monotone"
                  dataKey="baselineEnergy"
                  name="Shortest-Path Baseline"
                  stroke="#ef4444"
                  strokeWidth={2.2}
                  dot={false}
                />
                <Line
                  yAxisId="time"
                  type="monotone"
                  dataKey="journeyMinutes"
                  name="Journey Minutes"
                  stroke="#3b82f6"
                  strokeWidth={1.8}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-legend">
            <div className="legend-item">
              <span className="legend-color" style={{ background: '#10b981' }} />
              <span>KEASH Energy</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ background: '#ef4444' }} />
              <span>Baseline Energy</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ background: '#3b82f6' }} />
              <span>Journey Time</span>
            </div>
          </div>

          <div className="info-row">
            <span className="info-label">Selected Speed</span>
            <span className="info-value bold">{speedKph} km/h</span>
          </div>
          <div className="info-row">
            <span className="info-label">Projected KEASH-Baseline Delta</span>
            <span className="info-value bold" style={{ color: 'var(--success)' }}>
              {selectedSample && selectedSample.baselineEnergy > 0
                ? `${(
                    ((selectedSample.baselineEnergy - selectedSample.keashEnergy) /
                      selectedSample.baselineEnergy) *
                    100
                  ).toFixed(1)}%`
                : '--'}
            </span>
          </div>
        </div>
      </div>

      <div id="fleet" className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title">Fleet Status</h2>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div className="info-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Truck size={16} className="event-icon" />
              <span className="info-label">Active Vehicles in Solve</span>
            </div>
            <span className="info-value bold">{activePlatoonSize}</span>
          </div>
          <div className="info-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckSquare size={16} color="var(--text-muted)" />
              <span className="info-label">Backend Status</span>
            </div>
            <span className="info-value bold">{backendStatus}</span>
          </div>
          <div className="info-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} color="var(--warning)" />
              <span className="info-label">Environmental Layers</span>
            </div>
            <span className="info-value bold">{environmentLayers.length}</span>
          </div>
          <div className="map-legend">
            <div>
              <span className="legend-dot" style={{ background: '#22c55e' }} />
              Low traffic
            </div>
            <div>
              <span className="legend-dot" style={{ background: '#f59e0b' }} />
              Moderate traffic
            </div>
            <div>
              <span className="legend-dot" style={{ background: '#ef4444' }} />
              High traffic
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className={`app-container ${isMobile ? 'mobile-google-maps-mode' : ''}`}>
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <img src={logoImg} alt="RouteZero" className="logo-image" />
            <span className="logo-text">
              <span className="logo-text-route">Route</span>
              <span className="logo-text-zero">Zero</span>
            </span>
          </div>
          {!isMobile && <span className="header-subtitle">Dynamic & Quantum-Inspired Logistics</span>}
        </div>

        {!isMobile && (
          <nav className="desktop-center-nav">
            <a
              href="#optimize"
              className={`nav-link ${activeTab === 'optimize' ? 'active' : ''}`}
              onClick={(e) => scrollToSection(e, 'optimize')}
            >
              Optimization
            </a>
            <a
              href="#fleet"
              className={`nav-link ${activeTab === 'fleet' ? 'active' : ''}`}
              onClick={(e) => scrollToSection(e, 'fleet')}
            >
              Fleet Tracking
            </a>
            <a
              href="#analytics"
              className={`nav-link ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={(e) => scrollToSection(e, 'analytics')}
            >
              Analytics
            </a>
          </nav>
        )}

        <div className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          <Menu size={24} />
        </div>

        <div className="header-right desktop-nav">
          {!isMobile && (
            <>
              <div className="header-status">
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Solver Status</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    className="status-dot"
                    style={{
                      width: '8px',
                      height: '8px',
                      background: backendStatus.includes('Fallback') ? 'var(--warning)' : 'var(--success)',
                      borderRadius: '50%',
                    }}
                  />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {backendStatus.includes('Fallback') ? 'Fallback' : 'KEASH Live'}
                  </span>
                </div>
              </div>
              <div className="nav-separator" />
            </>
          )}
          <div className="nav-item-container">
            <Bell className="header-icon" size={20} onClick={() => togglePopup('notifications')} />
            {activePopup === 'notifications' && (
              <div className="nav-popup">
                <h4>Notifications</h4>
                <ul>
                  <li>
                    <div className="dot green" /> KEASH route graph updated
                  </li>
                </ul>
              </div>
            )}
          </div>
          <div className="nav-item-container">
            <Settings className="header-icon" size={20} onClick={() => togglePopup('settings')} />
            {activePopup === 'settings' && (
              <div className="nav-popup">
                <h4>Settings</h4>
                <ul>
                  <li>
                    <Shield size={14} /> Privacy & Security
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="mobile-dropdown-nav">
          <div className="mobile-nav-item" onClick={() => togglePopup('mobile-notifications')}>
            <span className="mobile-nav-text">Notifications</span>
          </div>
          {activePopup === 'mobile-notifications' && (
            <div className="mobile-popup-content">
              <li>KEASH route graph updated</li>
            </div>
          )}
          <div className="mobile-nav-item" onClick={() => togglePopup('mobile-settings')}>
            <span className="mobile-nav-text">Settings</span>
          </div>
          {activePopup === 'mobile-settings' && (
            <div className="mobile-popup-content">
              <li>Privacy & Security</li>
            </div>
          )}
        </div>
      )}

      <div className="map-background-wrapper">
        <MapContainer
          center={[51.505, -0.09]}
          zoom={4}
          minZoom={3}
          maxBounds={[
            [-85, -180],
            [85, 180],
          ]}
          maxBoundsViscosity={1.0}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <ZoomControl position="topright" />
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            noWrap
            bounds={[
              [-85, -180],
              [85, 180],
            ]}
          />

          {environmentLayers.map((layer) => (
            <Circle
              key={layer.id}
              center={layer.center}
              radius={layer.radius}
              pathOptions={{
                color: layer.trafficColor,
                fillColor: layer.trafficColor,
                fillOpacity: 0.14,
                weight: 1.2,
              }}
            >
              <Popup>
                <div style={{ fontSize: '0.8rem' }}>
                  <strong>Traffic:</strong> {layer.trafficLabel} ({Math.round(layer.trafficIndex)}%)
                  <br />
                  <strong>Slope:</strong> {layer.slopePercent}%
                </div>
              </Popup>
            </Circle>
          ))}

          {userLocation && (
            <Marker position={userLocation} icon={userIcon}>
              <Popup>Your Location</Popup>
            </Marker>
          )}

          {destinationCoords && (
            <Marker position={destinationCoords} icon={destIcon}>
              <Popup>Destination</Popup>
            </Marker>
          )}

          {!platooningEnabled && routePath.length > 0 && (
            <Polyline
              pathOptions={{ color: '#10b981', weight: 5, opacity: 0.85 }}
              positions={routePath}
            />
          )}

          {platooningEnabled &&
            platoonRoutes.map((path, index) => (
              <Polyline
                key={`platoon-path-${index}`}
                pathOptions={{
                  color: index === 0 ? '#059669' : '#0ea5e9',
                  weight: index === 0 ? 5 : 3,
                  opacity: index === 0 ? 0.95 : 0.7,
                  dashArray: index === 0 ? undefined : '8 8',
                }}
                positions={path}
              />
            ))}

          {platooningEnabled &&
            platoonMarkers.map((vehicle, index) => (
              <Marker
                key={vehicle.id}
                position={vehicle.position}
                icon={index === 0 ? depotIcon : platoonIcons[(index - 1) % platoonIcons.length]}
              >
                <Popup>Vehicle {vehicle.vehicle}</Popup>
              </Marker>
            ))}

          <MapController center={userLocation && !destinationCoords ? userLocation : null} bounds={mapBounds} />
        </MapContainer>
      </div>

      {!isMobile && <div className="desktop-floating-panel glass-panel">{renderSidebarContent()}</div>}

      {isMobile && (
        <div className={`bottom-sheet glass-panel ${bottomSheetExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="bottom-sheet-handle" onClick={() => setBottomSheetExpanded(!bottomSheetExpanded)}>
            <div style={{ textAlign: 'center', color: '#94a3b8' }}>
              {bottomSheetExpanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
            </div>
          </div>
          <div className="bottom-sheet-content">{renderSidebarContent()}</div>
        </div>
      )}

      {showDestModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">
              <MapPin
                size={24}
                style={{ display: 'inline', marginRight: 12, color: 'var(--brand-blue)' }}
              />
              Where to?
            </h3>
            <form onSubmit={handleSetDestination}>
              <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
                <div className="input-with-unit modern-search-input" style={{ marginBottom: 0 }}>
                  <Search
                    size={18}
                    style={{ position: 'absolute', left: 16, color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Enter a city or address..."
                    style={{ paddingLeft: '3rem', textAlign: 'left' }}
                    value={destQuery}
                    onChange={handleDestinationInputChange}
                  />
                </div>

                {isSearching && (
                  <p className="mini-note" style={{ marginTop: '0.4rem' }}>
                    Looking up destinations...
                  </p>
                )}

                {suggestions.length > 0 && (
                  <div className="suggestions-dropdown">
                    {suggestions.map((suggestion, index) => (
                      <div
                        key={`${suggestion.display_name}-${index}`}
                        className="suggestion-item"
                        onClick={() => {
                          handleSuggestionSelect(suggestion.display_name);
                        }}
                      >
                        <MapPin
                          size={16}
                          strokeWidth={2.5}
                          style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                        />
                        <span style={{ fontSize: '0.875rem', lineHeight: '1.2' }}>
                          {suggestion.display_name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  className="btn-primary btn-cancel"
                  onClick={closeDestinationModal}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary btn-green" disabled={isRouting}>
                  {isRouting ? 'Solving...' : 'Run KEASH'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
