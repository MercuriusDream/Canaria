import Supercluster from 'supercluster';
import type { AnyProps, ClusterFeature, PointFeature } from 'supercluster';

export interface Point {
    id: string;
    lat: number;
    lng: number;
    type: 'official' | 'p2p';
    volume?: number;
}

export type MapCluster = ClusterFeature<AnyProps> | PointFeature<AnyProps>;

export class SpatialIndex {
    private index: Supercluster;

    constructor(points: Point[]) {
        this.index = new Supercluster({
            radius: 40,
            maxZoom: 16
        });

        // Convert Points to GeoJSON Feature<Point>
        const features = points.map(p => ({
            type: 'Feature' as const,
            properties: {
                cluster: false,
                id: p.id,
                type: p.type,
                volume: p.volume
            },
            geometry: {
                type: 'Point' as const,
                coordinates: [p.lng, p.lat]
            }
        }));

        this.index.load(features);
    }

    getClusters(bbox: [number, number, number, number], zoom: number): MapCluster[] {
        return this.index.getClusters(bbox, zoom);
    }
}
