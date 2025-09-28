import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// Declare Leaflet in the global scope to avoid TypeScript errors
declare const L: any;

const TEHRAN_COORDS: [number, number] = [35.6892, 51.3890];
const GRAPHHOPPER_API_KEY = '3beb5520-f67f-4e2a-9471-250a0ff271e1';

function App() {
    const mapRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState(null);
    const [markers, setMarkers] = useState([]);
    const [path, setPath] = useState(null);
    const [eta, setEta] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [matchedUsersCount, setMatchedUsersCount] = useState(0);
    const matchIntervalRef = useRef<number | null>(null);
    
    type SelectionState = 'SELECTING_START' | 'SELECTING_END' | 'PATH_CONFIRMED' | 'SEARCHING_FOR_MATCH' | 'MATCH_FOUND';
    const [selectionState, setSelectionState] = useState<SelectionState>('SELECTING_START');

    const instructionText: Record<SelectionState, string> = {
        SELECTING_START: 'مبدأ خود را روی نقشه انتخاب کنید',
        SELECTING_END: 'مقصد خود را روی نقشه انتخاب کنید',
        PATH_CONFIRMED: 'مسیر شما انتخاب شد',
        SEARCHING_FOR_MATCH: 'در حال جستجو برای هم‌قدم...',
        MATCH_FOUND: 'هم‌قدم‌های شما پیدا شدند!',
    };

    // Initialize map
    useEffect(() => {
        if (mapRef.current && !mapInstance) {
            const map = L.map(mapRef.current).setView(TEHRAN_COORDS, 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);
            setMapInstance(map);
        }
    }, [mapRef, mapInstance]);

    // Handle map clicks for setting points
    useEffect(() => {
        if (!mapInstance || isLoading || selectionState === 'SEARCHING_FOR_MATCH' || selectionState === 'MATCH_FOUND') return;

        const handleMapClick = (e) => {
            if (selectionState === 'SELECTING_START' || selectionState === 'SELECTING_END') {
                 const { lat, lng } = e.latlng;
            
                if (selectionState === 'SELECTING_START') {
                    const startMarker = createMarker([lat, lng], 'start');
                    setMarkers([startMarker]);
                    setSelectionState('SELECTING_END');
                } else if (selectionState === 'SELECTING_END') {
                    const endMarker = createMarker([lat, lng], 'end');
                    setMarkers(prev => [...prev, endMarker]);
                    setSelectionState('PATH_CONFIRMED');
                }
            }
        };

        mapInstance.on('click', handleMapClick);

        return () => {
            mapInstance.off('click', handleMapClick);
        };
    }, [mapInstance, selectionState, isLoading]);
    
    // Reset function accessible from multiple places
    const handleReset = () => {
        if (!mapInstance) return;
        
        // Clear interval if it's running
        if (matchIntervalRef.current) {
            clearInterval(matchIntervalRef.current);
            matchIntervalRef.current = null;
        }

        // Clear markers
        markers.forEach(marker => mapInstance.removeLayer(marker));
        setMarkers([]);
        
        // Clear path
        if (path) {
            mapInstance.removeLayer(path);
            setPath(null);
        }

        // Reset state
        setEta(null);
        setMatchedUsersCount(0); // Reset match count
        setSelectionState('SELECTING_START');
        setIsLoading(false);
        mapInstance.setView(TEHRAN_COORDS, 13);
    };

    // Fetch route using GraphHopper API, draw path, and calculate ETA
    useEffect(() => {
        if (selectionState !== 'PATH_CONFIRMED' || markers.length !== 2 || !mapInstance) {
            return;
        }
        
        const fetchRoute = async () => {
            setIsLoading(true);
            try {
                const startLatLng = markers[0].getLatLng();
                const endLatLng = markers[1].getLatLng();

                const url = `https://graphhopper.com/api/1/route?point=${startLatLng.lat},${startLatLng.lng}&point=${endLatLng.lat},${endLatLng.lng}&profile=foot&points_encoded=false&key=${GRAPHHOPPER_API_KEY}`;
                
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();

                if (data.paths && data.paths.length > 0) {
                    const route = data.paths[0];
                    // GraphHopper returns [lng, lat], Leaflet needs [lat, lng], so we swap them.
                    const decodedPath = route.points.coordinates.map(p => [p[1], p[0]]);

                    const polyline = L.polyline(decodedPath, { 
                        color: '#4285F4', 
                        weight: 6,
                        opacity: 0.8,
                        dashArray: '1, 12'
                    }).addTo(mapInstance);
                    setPath(polyline);
                    
                    // Time is in milliseconds, convert to minutes
                    const durationMinutes = Math.round(route.time / 60000);
                    setEta(`حدود ${durationMinutes} دقیقه پیاده‌روی`);

                    mapInstance.fitBounds(polyline.getBounds().pad(0.2));
                } else {
                    throw new Error(data.message || 'No route found');
                }
            } catch (error) {
                console.error('Failed to fetch route:', error);
                alert(`مسیریابی با خطا مواجه شد. لطفا نقاط دیگری را امتحان کنید.`);
                handleReset();
            } finally {
                setIsLoading(false);
            }
        };

        fetchRoute();
    }, [selectionState, markers, mapInstance]);

    // Simulate finding matches and transition state when 3 are found
    useEffect(() => {
        if (selectionState === 'SEARCHING_FOR_MATCH') {
            // Reset count before starting
            setMatchedUsersCount(0);
            
            // Find a new user every 3 seconds
            matchIntervalRef.current = window.setInterval(() => {
                setMatchedUsersCount(prevCount => {
                    const newCount = prevCount + 1;
                    if (newCount >= 3) {
                        if (matchIntervalRef.current) {
                            clearInterval(matchIntervalRef.current);
                            matchIntervalRef.current = null;
                        }
                        setSelectionState('MATCH_FOUND');
                    }
                    return newCount;
                });
            }, 3000);
        }

        // Cleanup function to clear interval if component unmounts or state changes
        return () => {
            if (matchIntervalRef.current) {
                clearInterval(matchIntervalRef.current);
                matchIntervalRef.current = null;
            }
        };
    }, [selectionState]);

    const createMarker = (latlng, type) => {
        const iconHtml = `<div class="${type}-marker-icon"></div>`;
        const customIcon = L.divIcon({
            html: iconHtml,
            className: '', // important to clear default leaflet styles
            iconSize: [26, 26],
            iconAnchor: [13, 13],
        });
        return L.marker(latlng, { icon: customIcon }).addTo(mapInstance);
    };

    const handleConfirm = () => {
        setSelectionState('SEARCHING_FOR_MATCH');
    };

    return (
        <>
            <div id="map-container" ref={mapRef} className="map-container"></div>
            {(selectionState === 'SELECTING_START' || selectionState === 'SELECTING_END') && !isLoading && (
                <div className="instruction-banner" aria-live="polite">
                    {instructionText[selectionState]}
                </div>
            )}
             {isLoading && (
                <div className="instruction-banner" aria-live="polite">
                    در حال مسیریابی...
                </div>
            )}
            <div className={`bottom-sheet ${(selectionState === 'PATH_CONFIRMED' || selectionState === 'SEARCHING_FOR_MATCH' || selectionState === 'MATCH_FOUND') && !isLoading ? 'visible' : ''}`}>
                {selectionState === 'PATH_CONFIRMED' && (
                    <>
                        {eta && (
                            <div className="eta-info">
                                <span className="label">زمان تخمینی رسیدن</span>
                                <span className="value">{eta}</span>
                            </div>
                        )}
                        <button className="confirm-button" onClick={handleConfirm} disabled={isLoading}>
                            تایید و پیدا کردن هم‌قدم
                        </button>
                        <button className="reset-button" onClick={handleReset} disabled={isLoading}>
                            انتخاب مجدد مسیر
                        </button>
                    </>
                )}
                {selectionState === 'SEARCHING_FOR_MATCH' && (
                     <div className="searching-view">
                        <div className="spinner"></div>
                        <h3>{instructionText[selectionState]}</h3>
                        <div className="match-counter">
                            <span className="count">{matchedUsersCount}</span>
                            <span className="label">نفر در این مسیر پیدا شد</span>
                        </div>
                        <button className="cancel-button" onClick={handleReset}>
                            لغو جستجو
                        </button>
                    </div>
                )}
                {selectionState === 'MATCH_FOUND' && (
                     <div className="match-found-view">
                        <div className="success-icon">✓</div>
                        <h3>{instructionText[selectionState]}</h3>
                        <p className="sub-instruction">لطفا به نقطه شروع حرکت کنید</p>
                        <button className="confirm-button" onClick={handleReset}>
                            پایان پیاده‌روی
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);