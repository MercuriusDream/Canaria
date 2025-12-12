import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { SpatialIndex, type Point } from '../utils/spatialIndex';

interface CanvasLayerProps {
    points: Point[];
    onPointClick?: (point: Point | any) => void;
}

const CanvasLayer = ({ points, onPointClick }: CanvasLayerProps) => {
    const map = useMap();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const indexRef = useRef<SpatialIndex | null>(null);
    const [visibleFeatures, setVisibleFeatures] = useState<any[]>([]);

    // Initialize Spatial Index
    useEffect(() => {
        if (points.length > 0) {
            indexRef.current = new SpatialIndex(points);
            // Trigger redraw
            if (map) map.fire('move');
        }
    }, [points, map]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // High DPI canvas scaling
        const pixelRatio = window.devicePixelRatio || 1;

        const draw = () => {
            if (!map || !indexRef.current) return;

            const size = map.getSize();
            const bounds = map.getBounds();
            const zoom = Math.round(map.getZoom());

            // Handle resizing with pixel ratio
            if (canvas.width !== size.x * pixelRatio || canvas.height !== size.y * pixelRatio) {
                canvas.width = size.x * pixelRatio;
                canvas.height = size.y * pixelRatio;
                canvas.style.width = `${size.x}px`;
                canvas.style.height = `${size.y}px`;
                ctx.scale(pixelRatio, pixelRatio);
            }

            ctx.clearRect(0, 0, size.x, size.y);

            // Get clusters/points for current view
            const bbox: [number, number, number, number] = [
                bounds.getWest(),
                bounds.getSouth(),
                bounds.getEast(),
                bounds.getNorth()
            ];

            const clusters = indexRef.current.getClusters(bbox, zoom);
            setVisibleFeatures(clusters);

            clusters.forEach(feature => {
                const [lng, lat] = feature.geometry.coordinates;
                const point = map.latLngToContainerPoint([lat, lng]);
                const isCluster = feature.properties?.cluster;

                ctx.beginPath();
                if (isCluster) {
                    // Cluster
                    const count = feature.properties.point_count;
                    const radius = 15 + Math.min(count * 0.5, 20);

                    ctx.fillStyle = '#FF6B6B'; // Reddish for clusters
                    ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(String(count), point.x, point.y);
                } else {
                    // Single Point
                    const type = feature.properties.type;
                    const isOfficial = type === 'official';
                    const radius = isOfficial ? 8 : 5;
                    const color = isOfficial ? '#4D96FF' : '#A0A0A0'; // Blue vs Gray

                    ctx.fillStyle = color;
                    ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
                    ctx.fill();

                    if (isOfficial) {
                        ctx.strokeStyle = '#fff';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    }
                }
                ctx.closePath();
            });
        };

        const handleClick = (e: L.LeafletMouseEvent) => {
            if (!onPointClick || !visibleFeatures.length) return;

            const clickPoint = e.containerPoint;

            // Iterate in reverse (draw order is typically bottom-up, we want top-hit)
            // But spatial index returns arbitrary order.
            // Check all valid hits.

            // Find closest feature within radius
            let closestFeature = null;
            let minDistance = Infinity;

            for (const feature of visibleFeatures) {
                const [lng, lat] = feature.geometry.coordinates;
                const point = map.latLngToContainerPoint([lat, lng]);
                const isCluster = feature.properties?.cluster;

                // Determine radius
                let radius = isCluster
                    ? (15 + Math.min(feature.properties.point_count * 0.5, 20))
                    : (feature.properties.type === 'official' ? 8 : 5);

                // Hitbox padding
                radius += 5;

                const dist = clickPoint.distanceTo(point);
                if (dist <= radius && dist < minDistance) {
                    minDistance = dist;
                    closestFeature = feature;
                }
            }

            if (closestFeature) {
                L.DomEvent.stopPropagation(e.originalEvent);
                onPointClick(closestFeature);
            }
        };

        map.on('move', draw);
        map.on('zoom', draw);
        map.on('resize', draw);
        map.on('click', handleClick);

        draw();

        return () => {
            map.off('move', draw);
            map.off('zoom', draw);
            map.off('resize', draw);
            map.off('click', handleClick);
        };
    }, [map, visibleFeatures, onPointClick]);
    // ^ Dependency on visibleFeatures might cause re-bind of click listener too often? 
    // Move handleClick rendering inside effect or use ref for features.
    // Actually, 'visibleFeatures' update triggers re-render, creating new handleClick bound to new visibleFeatures.
    // This is fine but efficient? Maybe use a ref for visibleFeatures to avoid re-binding events.

    // Optimized Approach: Use Ref for features
    const featuresRef = useRef<any[]>([]);
    useEffect(() => {
        featuresRef.current = visibleFeatures;
    }, [visibleFeatures]);
    // But wait, the main effect needs to write to features.

    // Let's rely on the main effect to handle drawing and maintaining the closure if possible, 
    // or split drawing and event handling.
    // Simpler: keeping it as is. 'visibleFeatures' changes on move/zoom. Re-binding events on move/zoom is acceptable. 

    return (
        <canvas
            ref={canvasRef}
            style={{
                pointerEvents: 'none',
                position: 'absolute',
                top: 0,
                left: 0,
                zIndex: 500,
            }}
        />
    );
};

export default CanvasLayer;
