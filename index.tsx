import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// Declare Leaflet in the global scope to avoid TypeScript errors
declare const L: any;

const TEHRAN_COORDS: [number, number] = [35.6892, 51.3890];

// Decodes a Google Maps encoded polyline string into an array of lat/lng pairs
function decodePolyline(encoded: string): [number, number][] {
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    const path: [number, number][] = [];

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        
        path.push([lat / 1e5, lng / 1e5]);
    }
    return path;
}


function App() {
    const mapRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState(null);
    const [markers, setMarkers] = useState([]);
    const [path, setPath] = useState(null);
    const [eta, setEta] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    
    type SelectionState = 'SELECTING_START' | 'SELECTING_END' | 'PATH_CONFIRMED';
    const [selectionState, setSelectionState] = useState<SelectionState>('SELECTING_START');

    const instructionText: Record<SelectionState, string> = {
        SELECTING_START: 'مبدأ خود را روی نقشه انتخاب کنید',
        SELECTING_END: 'مقصد خود را روی نقشه انتخاب کنید',
        PATH_CONFIRMED: 'مسیر شما انتخاب شد',
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
        if (!mapInstance || isLoading) return;

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
        setSelectionState('SELECTING_START');
        setIsLoading(false);
        mapInstance.setView(TEHRAN_COORDS, 13);
    };


    // Fetch route from Google Directions API, draw path, and calculate ETA
    useEffect(() => {
        if (selectionState === 'PATH_CONFIRMED' && markers.length === 2 && mapInstance) {
            const startLatLng = markers[0].getLatLng();
            const endLatLng = markers[1].getLatLng();

            const fetchRoute = async () => {
                setIsLoading(true);
                // IMPORTANT: API_KEY is expected to be in the environment variables.
                const apiKey = process.env.API_KEY;
                if (!apiKey) {
                    console.error("Google Maps API Key is missing.");
                    alert("خطا: کلید API برای مسیریابی یافت نشد.");
                    handleReset();
                    return;
                }

                const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${startLatLng.lat},${startLatLng.lng}&destination=${endLatLng.lat},${endLatLng.lng}&mode=walking&key=${apiKey}`;
                
                try {
                    const response = await fetch(url);
                    const data = await response.json();

                    if (data.status === 'OK') {
                        const route = data.routes[0];
                        const encodedPolyline = route.overview_polyline.points;
                        const decodedPath = decodePolyline(encodedPolyline);

                        const polyline = L.polyline(decodedPath, { 
                            color: '#4285F4', 
                            weight: 6,
                            opacity: 0.8,
                            dashArray: '1, 12'
                        }).addTo(mapInstance);
                        setPath(polyline);

                        const durationText = route.legs[0].duration.text;
                        const farsiDuration = durationText
                            .replace(/mins|min/g, 'دقیقه')
                            .replace(/hours|hour/g, 'ساعت');
                        setEta(`حدود ${farsiDuration} پیاده‌روی`);

                        mapInstance.fitBounds(polyline.getBounds().pad(0.2));
                    } else {
                        console.error('Directions API error:', data.status, data.error_message);
                        alert(`مسیریابی با خطا مواجه شد. لطفا نقاط دیگری را امتحان کنید.`);
                        handleReset();
                    }
                } catch (error) {
                    console.error('Failed to fetch route:', error);
                    alert('خطا در برقراری ارتباط با سرویس مسیریابی.');
                    handleReset();
                } finally {
                    setIsLoading(false);
                }
            };

            fetchRoute();
        }
    }, [selectionState, markers, mapInstance]);

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
        // Here you would proceed to the next step (finding matches)
        alert('در حال جستجو برای هم‌قدم...');
    };

    return (
        <>
            <div id="map-container" ref={mapRef} className="map-container"></div>
            {selectionState !== 'PATH_CONFIRMED' && !isLoading && (
                <div className="instruction-banner" aria-live="polite">
                    {instructionText[selectionState]}
                </div>
            )}
             {isLoading && (
                <div className="instruction-banner" aria-live="polite">
                    در حال مسیریابی...
                </div>
            )}
            <div className={`bottom-sheet ${selectionState === 'PATH_CONFIRMED' && !isLoading ? 'visible' : ''}`}>
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
            </div>
        </>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);