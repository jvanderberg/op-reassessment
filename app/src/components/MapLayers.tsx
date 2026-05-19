import type { FeatureCollection } from 'geojson';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { formatCurrency, formatPercent, increaseColor } from '../constants';
import type { Reassessment } from '../types';

export function MapBounds({ properties }: { properties: Reassessment[] }) {
	const map = useMap();
	const didFit = useRef(false);

	useEffect(() => {
		const mappable = properties.filter((p) => p.lat && p.lon);
		if (didFit.current || mappable.length === 0) return;
		didFit.current = true;
		const lats = mappable.map((p) => p.lat as number);
		const lons = mappable.map((p) => p.lon as number);
		map.fitBounds([
			[Math.min(...lats), Math.min(...lons)],
			[Math.max(...lats), Math.max(...lons)],
		]);
	}, [properties, map]);

	return null;
}

export function BoundaryLayer({
	boundary,
	isDarkMode,
}: {
	boundary: FeatureCollection;
	isDarkMode: boolean;
}) {
	const map = useMap();
	const layerRef = useRef<L.GeoJSON | null>(null);

	useEffect(() => {
		if (layerRef.current) {
			map.removeLayer(layerRef.current);
		}
		layerRef.current = L.geoJSON(boundary, {
			style: {
				color: isDarkMode ? '#f8fafc' : '#404040',
				weight: 3,
				fillOpacity: 0,
				dashArray: '6 4',
			},
			interactive: false,
		}).addTo(map);

		return () => {
			if (layerRef.current) map.removeLayer(layerRef.current);
		};
	}, [boundary, isDarkMode, map]);

	return null;
}

function popup(property: Reassessment): HTMLElement {
	const div = document.createElement('div');
	div.style.fontSize = '12px';
	div.innerHTML = [
		`<strong>${property.address || 'No address'}</strong>`,
		`PIN: <a href="${property.url}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">${property.pin}</a>`,
		`Class: ${property.class} — ${property.classDescription}`,
		`Neighborhood: ${property.neighborhood || 'Unknown'}`,
		`2025 market value (${property.assessment2025.stage}): ${formatCurrency(property.assessment2025.total)}`,
		`2026 market value (${property.assessment2026.stage}): ${formatCurrency(property.assessment2026.total)}`,
		`Increase: ${formatCurrency(property.increase)} (${formatPercent(property.increasePct)})`,
	]
		.filter(Boolean)
		.join('<br>');
	return div;
}

function geometryFingerprint(feature: GeoJSON.Feature) {
	const geometry = feature.geometry;
	if (!geometry) return '';
	if (geometry.type === 'Polygon')
		return JSON.stringify(geometry.coordinates[0]?.[0]);
	if (geometry.type === 'MultiPolygon') {
		return JSON.stringify(geometry.coordinates[0]?.[0]?.[0]);
	}
	return JSON.stringify(geometry);
}

function polygonLatLngs(feature: GeoJSON.Feature) {
	const geometry = feature.geometry;
	if (!geometry) return null;
	if (geometry.type === 'Polygon') {
		return geometry.coordinates.map((ring) =>
			ring.map(([lon, lat]) => [lat, lon] as [number, number]),
		);
	}
	if (geometry.type === 'MultiPolygon') {
		return geometry.coordinates.map((polygon) =>
			polygon.map((ring) =>
				ring.map(([lon, lat]) => [lat, lon] as [number, number]),
			),
		);
	}
	return null;
}

export function ReassessmentMarkers({
	properties,
	parcels,
}: {
	properties: Reassessment[];
	parcels: FeatureCollection | null;
}) {
	const map = useMap();
	const layerRef = useRef<L.LayerGroup | null>(null);
	const rendererRef = useRef<L.Canvas | null>(null);

	useEffect(() => {
		if (!map.getPane('markers')) {
			const pane = map.createPane('markers');
			pane.style.zIndex = '460';
		}
		if (!rendererRef.current) {
			rendererRef.current = L.canvas({ padding: 0.5, pane: 'markers' });
		}
		if (!layerRef.current) {
			layerRef.current = L.layerGroup().addTo(map);
		}

		const layer = layerRef.current;
		const renderer = rendererRef.current;
		layer.clearLayers();

		const displayedPins = new Set(properties.map((p) => p.pin));
		const byPin = new Map(properties.map((p) => [p.pin, p]));
		const renderedPins = new Set<string>();

		if (parcels) {
			const groups = new Map<
				string,
				{ feature: GeoJSON.Feature; pins: string[] }
			>();
			for (const feature of parcels.features as GeoJSON.Feature[]) {
				const pin = String(
					feature.properties?.pin || feature.properties?.name || '',
				);
				if (!pin || !displayedPins.has(pin)) continue;
				const key = geometryFingerprint(feature);
				const existing = groups.get(key);
				if (existing) existing.pins.push(pin);
				else groups.set(key, { feature, pins: [pin] });
			}

			for (const group of groups.values()) {
				const first = byPin.get(group.pins[0]);
				const latLngs = polygonLatLngs(group.feature);
				if (!first || !latLngs) continue;
				const color = increaseColor(first.increasePct);
				L.polygon(latLngs as L.LatLngExpression[] | L.LatLngExpression[][], {
					color,
					fillColor: color,
					fillOpacity: 0.62,
					weight: 1,
					renderer,
					pane: 'markers',
				})
					.bindPopup(() => popup(first))
					.addTo(layer);
				for (const pin of group.pins) renderedPins.add(pin);
			}
		}

		for (const property of properties) {
			if (renderedPins.has(property.pin) || !property.lat || !property.lon)
				continue;
			const color = increaseColor(property.increasePct);
			L.circleMarker([property.lat, property.lon], {
				radius: 4,
				color,
				fillColor: color,
				fillOpacity: 0.8,
				weight: 1,
				renderer,
				pane: 'markers',
			})
				.bindPopup(() => popup(property))
				.addTo(layer);
		}

		return () => {
			layer.clearLayers();
		};
	}, [properties, parcels, map]);

	return null;
}

export function HighlightMarker({
	property,
	isDarkMode,
}: {
	property: Reassessment | null;
	isDarkMode: boolean;
}) {
	const map = useMap();
	const markerRef = useRef<L.CircleMarker | null>(null);
	const ringRef = useRef<L.CircleMarker | null>(null);

	useEffect(() => {
		if (markerRef.current) {
			map.removeLayer(markerRef.current);
			markerRef.current = null;
		}
		if (ringRef.current) {
			map.removeLayer(ringRef.current);
			ringRef.current = null;
		}
		if (!property?.lat || !property.lon) return;

		if (!map.getPane('highlight')) {
			const pane = map.createPane('highlight');
			pane.style.zIndex = '470';
			pane.style.pointerEvents = 'none';
		}

		const latlng: [number, number] = [property.lat, property.lon];
		const color = isDarkMode ? '#f8fafc' : '#111827';
		map.setView(latlng, 18);

		ringRef.current = L.circleMarker(latlng, {
			radius: 14,
			color,
			weight: 2,
			fillOpacity: 0,
			interactive: false,
			pane: 'highlight',
		}).addTo(map);

		markerRef.current = L.circleMarker(latlng, {
			radius: 5,
			color,
			fillColor: color,
			fillOpacity: 1,
			weight: 2,
			interactive: false,
			pane: 'highlight',
		}).addTo(map);

		return () => {
			if (markerRef.current) map.removeLayer(markerRef.current);
			if (ringRef.current) map.removeLayer(ringRef.current);
		};
	}, [property, isDarkMode, map]);

	return null;
}
