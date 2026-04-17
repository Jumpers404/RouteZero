import React, { useState, useEffect } from 'react';
import { Bell, Settings, CheckSquare, Menu, LogOut, User, Shield, Truck, AlertTriangle, ChevronUp, ChevronDown, MapPin, Search } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import './App.css';

// Fix leaflet default icon issue in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom Icons
const depotIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const destIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const userIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const chartData = [
  { time: '1', cost: 100, timeVal: 60, emissions: 20 },
  { time: '2', cost: 80, timeVal: 40, emissions: 40 },
  { time: '3', cost: 60, timeVal: 50, emissions: 30 },
  { time: '4', cost: 20, timeVal: 80, emissions: 50 },
  { time: '5', cost: 50, timeVal: 30, emissions: 90 },
  { time: '6', cost: 80, timeVal: 60, emissions: 60 },
  { time: '7', cost: 95, timeVal: 20, emissions: 40 },
];

function MapController({ center, bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (center) {
      map.flyTo(center, 14, { duration: 1.5 });
    }
  }, [center, bounds, map]);
  return null;
}

function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activePopup, setActivePopup] = useState(null);

  // Mobile dragging panel state
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);

  // Routing and Mapping
  const [userLocation, setUserLocation] = useState(null);
  const [destinationCoords, setDestinationCoords] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [mapBounds, setMapBounds] = useState(null);

  // Destination Prompt
  const [showDestModal, setShowDestModal] = useState(false);
  const [destQuery, setDestQuery] = useState("");
  const [isRouting, setIsRouting] = useState(false);

  // Form states
  const [fuelPriority, setFuelPriority] = useState(80);
  const [timePriority, setTimePriority] = useState(30);
  const [co2Priority, setCo2Priority] = useState(60);
  const [payloadWeight, setPayloadWeight] = useState(1200);

  // Readonly data
  const [routeSummary, setRouteSummary] = useState({ route: "A → C → E → B → D", time: "3h 45m", distance: "120 km" });

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setIsMobileMenuOpen(false);
    };
    window.addEventListener('resize', handleResize);

    // Request Location once mounted
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = [position.coords.latitude, position.coords.longitude];
          setUserLocation(coords);
          setTimeout(() => setShowDestModal(true), 1500); // Ask for dest after a bit
        },
        (error) => console.error("Error getting user location:", error),
        { enableHighAccuracy: true }
      );
    }
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSetDestination = async (e) => {
    e.preventDefault();
    if (!destQuery || !userLocation) return;

    setIsRouting(true);
    try {
      // 1. Geocode Destination
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destQuery)}`);
      const geoData = await geoRes.json();

      if (!geoData || geoData.length === 0) {
        alert("Could not find that destination");
        setIsRouting(false);
        return;
      }

      const target = [parseFloat(geoData[0].lat), parseFloat(geoData[0].lon)];
      setDestinationCoords(target);

      // 2. OSRM Routing
      // OSRM wants coordinates in Longitude, Latitude order
      const startParam = `${userLocation[1]},${userLocation[0]}`;
      const endParam = `${target[1]},${target[0]}`;

      const routeRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${startParam};${endParam}?overview=full&geometries=geojson`);
      const routeData = await routeRes.json();

      if (routeData.code === "Ok") {
        // Map [lng, lat] back to [lat, lng] for Leaflet
        const coords = routeData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        setRoutePath(coords);

        const distKm = (routeData.routes[0].distance / 1000).toFixed(1);
        const timeHrs = Math.floor(routeData.routes[0].duration / 3600);
        const timeMins = Math.floor((routeData.routes[0].duration % 3600) / 60);
        setRouteSummary({ route: `Current Location → ${geoData[0].name.split(',')[0]}`, distance: `${distKm} km`, time: `${timeHrs}h ${timeMins}m` });

        // Update bounds to fit both points
        setMapBounds([userLocation, target]);
      }
    } catch (err) {
      console.error(err);
      alert("Error calculating route");
    } finally {
      setIsRouting(false);
      setShowDestModal(false);
      setBottomSheetExpanded(true); // Pop up info sheet once routed
    }
  };

  const togglePopup = (popupType) => {
    if (activePopup === popupType) setActivePopup(null);
    else setActivePopup(popupType);
  };

  const renderSidebarContent = () => (
    <>
      {/* Search Route Card on top inside bottom sheet or left sidebar */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Optimize Route</h2>
        </div>
        <div className="card-body">
          <div className="control-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="control-label" style={{ marginBottom: 0 }}>Fuel Priority</label>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--success)' }}>{fuelPriority}%</span>
            </div>
            <input type="range" min="0" max="100" value={fuelPriority} onChange={(e) => setFuelPriority(Number(e.target.value))} className="slider-green modern-slider" />
          </div>

          <div className="control-group" style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="control-label" style={{ marginBottom: 0 }}>Duration Priority</label>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--brand-blue)' }}>{timePriority}%</span>
            </div>
            <input type="range" min="0" max="100" value={timePriority} onChange={(e) => setTimePriority(Number(e.target.value))} className="slider-blue modern-slider" />
          </div>

          <div className="control-group" style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="control-label" style={{ marginBottom: 0 }}>Emissions Priority</label>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--brand-color)' }}>{co2Priority}%</span>
            </div>
            <input type="range" min="0" max="100" value={co2Priority} onChange={(e) => setCo2Priority(Number(e.target.value))} className="slider-teal modern-slider" />
          </div>
          <div className="control-group" style={{ marginTop: '2rem' }}>
            <label className="control-label">Payload Weight</label>
            <div className="input-with-unit">
              <input type="number" value={payloadWeight} onChange={(e) => setPayloadWeight(Number(e.target.value))} />
              <span className="unit">kg</span>
            </div>
          </div>
          <button className="btn-primary btn-green" onClick={() => setShowDestModal(true)}>Set New Route Destination</button>
        </div>
      </div>

      {/* Fleet Status */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header"><h2 className="card-title">Fleet Status</h2></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="info-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Truck size={16} className="event-icon" /><span className="info-label">Active En-route</span></div>
            <span className="info-value bold">14</span>
          </div>
          <div className="info-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><CheckSquare size={16} color="var(--text-muted)" /><span className="info-label">Standby / Idle</span></div>
            <span className="info-value bold">2</span>
          </div>
          <div className="info-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><AlertTriangle size={16} color="var(--warning)" /><span className="info-label">Needs Maintenance</span></div>
            <span className="info-value bold" style={{ color: 'var(--warning)' }}>1</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid rgba(226, 232, 240, 0.5)' }}>
          <h2 className="card-title">Route Summary</h2>
        </div>
        <div className="card-body right-sidebar-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '1rem' }}>
          <div className="info-row" style={{ alignItems: 'center' }}>
            <span className="info-label">Route:</span>
            <span className="info-value bold route-path" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {routeSummary.route.split('→').map((part, i, arr) => (
                <React.Fragment key={i}>
                  <span>{part.trim()}</span>
                  {i < arr.length - 1 && <span style={{ color: '#cbd5e1', fontSize: '0.9em' }}>→</span>}
                </React.Fragment>
              ))}
            </span>
          </div>
          <div className="info-row"><span className="info-label">Estimated Time:</span><span className="info-value bold">{routeSummary.time}</span></div>
          <div className="info-row"><span className="info-label">Distance:</span><span className="info-value bold">{routeSummary.distance}</span></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid rgba(226, 232, 240, 0.5)' }}>
          <h2 className="card-title">Sustainability Metrics</h2>
        </div>
        <div className="card-body right-sidebar-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '1rem' }}>
          <div className="info-row"><span className="info-label">CO₂ Saved:</span><span className="info-value bold">58 kg</span></div>
          <div className="info-row"><span className="info-label">Fuel Saved:</span><span className="info-value bold">24.5 L</span></div>
          <div className="info-row"><span className="info-label">Green Score:</span><span className="info-value bold" style={{ color: 'var(--success)', fontSize: '1.125rem' }}>92</span></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid rgba(226, 232, 240, 0.5)' }}>
          <h2 className="card-title">Risk Analysis</h2>
        </div>
        <div className="card-body right-sidebar-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '1rem' }}>
          <div className="info-row"><span className="info-label">Weather Risk:</span><span className="info-value bold">65%</span></div>
          <div className="info-row"><span className="info-label">Traffic Variance:</span><span className="info-value bold" style={{ color: 'var(--success)' }}>Moderate</span></div>
          <div className="info-row" style={{ paddingBottom: '1rem', borderBottom: '1px solid rgba(226, 232, 240, 0.5)' }}><span className="info-label">Delay Probability:</span><span className="info-value bold">30%</span></div>

          <h3 className="card-title" style={{ fontSize: '0.9375rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>Quantum Solver Active</h3>

          <div className="info-row"><span className="info-label">Algorithm:</span><span className="info-value">SQA + MCMC</span></div>
          <div className="info-row" style={{ alignItems: 'center' }}>
            <span className="info-label">Iterations:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span className="info-value bold">2,341</span>
              <div style={{ width: '60px', height: '6px', background: 'rgba(226,232,240,0.4)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: '80%', height: '100%', background: 'var(--success)' }} />
              </div>
            </div>
          </div>
          <div className="info-row" style={{ alignItems: 'center' }}>
            <span className="info-label">Confidence:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span className="info-value bold">94%</span>
              <div style={{ width: '60px', height: '6px', background: 'rgba(226,232,240,0.4)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: '94%', height: '100%', background: 'var(--success)' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header"><h2 className="card-title">Optimization Insights</h2></div>
        <div className="card-body insights-body">
          <div className="insights-content" style={{ flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="time" hide />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <ReferenceLine x="4" stroke="#e2e8f0" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={3} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="timeVal" stroke="#eab308" strokeWidth={3} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="emissions" stroke="#10b981" strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
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
          <div className="logo"><div className="logo-icon">R</div><span>RouteZero</span></div>
          {!isMobile && <span className="header-subtitle">Dynamic & Quantum-Inspired Logistics</span>}
        </div>

        <div className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          <Menu size={24} />
        </div>

        <div className="header-right desktop-nav">
          <div className="nav-item-container">
            <Bell className="header-icon" size={20} onClick={() => togglePopup('notifications')} />
            {activePopup === 'notifications' && (
              <div className="nav-popup">
                <h4>Notifications</h4>
                <ul><li><div className="dot green"></div> Storm update received</li></ul>
              </div>
            )}
          </div>
          <div className="nav-item-container">
            <Settings className="header-icon" size={20} onClick={() => togglePopup('settings')} />
            {activePopup === 'settings' && (
              <div className="nav-popup"><h4>Settings</h4><ul><li><Shield size={14} /> Privacy & Security</li></ul></div>
            )}
          </div>
          {/* User profile avatar removed as requested */}
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="mobile-dropdown-nav">
          <div className="mobile-nav-item" onClick={() => togglePopup('mobile-notifications')}><span className="mobile-nav-text">Notifications (3 new)</span></div>
          {activePopup === 'mobile-notifications' && <div className="mobile-popup-content"><li>Storm update received</li></div>}
          <div className="mobile-nav-item" onClick={() => togglePopup('mobile-settings')}><span className="mobile-nav-text">Settings</span></div>
          {activePopup === 'mobile-settings' && <div className="mobile-popup-content"><li>Privacy & Security</li></div>}
        </div>
      )}

      {/* Map is always background, full screen */}
      <div className="map-background-wrapper">
        <MapContainer
          center={[51.505, -0.09]}
          zoom={4}
          minZoom={3}
          maxBounds={[[-85, -180], [85, 180]]}
          maxBoundsViscosity={1.0}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <ZoomControl position="topright" />
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            noWrap={true}
            bounds={[[-85, -180], [85, 180]]}
          />
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
          {routePath.length > 0 && (
            <Polyline pathOptions={{ color: '#10b981', weight: 5, opacity: 0.8 }} positions={routePath} />
          )}
          <MapController center={userLocation && !destinationCoords ? userLocation : null} bounds={mapBounds} />
        </MapContainer>
      </div>

      {/* Desktop Main Layout */}
      {!isMobile && (
        <div className="desktop-floating-panel glass-panel">
          {renderSidebarContent()}
        </div>
      )}

      {/* Mobile Draggable Bottom Sheet */}
      {isMobile && (
        <div className={`bottom-sheet glass-panel ${bottomSheetExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="bottom-sheet-handle" onClick={() => setBottomSheetExpanded(!bottomSheetExpanded)}>
            <div style={{ textAlign: 'center', color: '#94a3b8' }}>
              {bottomSheetExpanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
            </div>
          </div>
          <div className="bottom-sheet-content">
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Destination Modal */}
      {showDestModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title"><MapPin size={24} style={{ display: 'inline', marginRight: 12, color: 'var(--brand-blue)' }} /> Where to?</h3>
            <form onSubmit={handleSetDestination}>
              <div className="input-with-unit modern-search-input" style={{ marginBottom: '1.5rem' }}>
                <Search size={18} style={{ position: 'absolute', left: 16, color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  autoFocus
                  placeholder="Enter a city or address..."
                  style={{ paddingLeft: '3rem', textAlign: 'left' }}
                  value={destQuery}
                  onChange={e => setDestQuery(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="btn-primary btn-cancel" onClick={() => setShowDestModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary btn-green" disabled={isRouting}>{isRouting ? 'Routing...' : 'Find Route'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
