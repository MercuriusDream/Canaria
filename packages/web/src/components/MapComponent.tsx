import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { type ReactNode } from 'react';

// Fix for default marker icons missing in Leaflet + bundlers
// (Only needed if we use default markers, but we plan to use Canvas)
// Keeping it simple for now.

interface MapComponentProps {
    children?: ReactNode;
}

const MapComponent = ({ children }: MapComponentProps) => {
    return (
        <MapContainer
            center={[51.505, -0.09]} // Default center (can be user's location later)
            zoom={13}
            style={{ height: '100%', width: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }}
            scrollWheelZoom={true}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {children}
        </MapContainer>
    );
};

export default MapComponent;
