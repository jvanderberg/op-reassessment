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

function collectLatLngs(
	latLngs: unknown,
	out: [number, number][] = [],
): [number, number][] {
	if (!Array.isArray(latLngs)) return out;
	if (
		latLngs.length === 2 &&
		typeof latLngs[0] === 'number' &&
		typeof latLngs[1] === 'number'
	) {
		out.push(latLngs as [number, number]);
		return out;
	}
	for (const item of latLngs) collectLatLngs(item, out);
	return out;
}

function polygonCenter(feature: GeoJSON.Feature) {
	const latLngs = polygonLatLngs(feature);
	const points = collectLatLngs(latLngs);
	if (points.length === 0) return null;
	return L.latLngBounds(points).getCenter();
}

function offsetLatLng(
	center: L.LatLngExpression,
	index: number,
	total: number,
) {
	const latLng = L.latLng(center);
	if (total <= 1) return latLng;

	const angle = index * 2.399963229728653;
	const radiusMeters = 6 + Math.sqrt(index) * 5;
	const latOffset = (Math.sin(angle) * radiusMeters) / 111_320;
	const lonOffset =
		(Math.cos(angle) * radiusMeters) /
		(111_320 * Math.cos((latLng.lat * Math.PI) / 180));

	return L.latLng(latLng.lat + latOffset, latLng.lng + lonOffset);
}

function addPointMarker(
	layer: L.LayerGroup,
	renderer: L.Canvas,
	property: Reassessment,
	latLng: L.LatLngExpression,
) {
	const color = increaseColor(property.increasePct);
	L.circleMarker(latLng, {
		radius: 4,
		color,
		fillColor: color,
		fillOpacity: 0.82,
		weight: 1,
		renderer,
		pane: 'markers',
	})
		.bindPopup(() => popup(property))
		.addTo(layer);
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
				const latLngs = polygonLatLngs(group.feature);
				if (!latLngs) continue;

				if (group.pins.length === 1) {
					const property = byPin.get(group.pins[0]);
					if (!property) continue;
					const color = increaseColor(property.increasePct);
					L.polygon(latLngs as L.LatLngExpression[] | L.LatLngExpression[][], {
						color,
						fillColor: color,
						fillOpacity: 0.62,
						weight: 1,
						renderer,
						pane: 'markers',
					})
						.bindPopup(() => popup(property))
						.addTo(layer);
					renderedPins.add(property.pin);
					continue;
				}

				const center = polygonCenter(group.feature);
				if (!center) continue;
				L.polygon(latLngs as L.LatLngExpression[] | L.LatLngExpression[][], {
					color: '#737373',
					fillColor: '#737373',
					fillOpacity: 0.08,
					weight: 1,
					renderer,
					pane: 'markers',
					interactive: false,
				}).addTo(layer);
				group.pins.forEach((pin, index) => {
					const property = byPin.get(pin);
					if (!property) return;
					addPointMarker(
						layer,
						renderer,
						property,
						offsetLatLng(center, index, group.pins.length),
					);
					renderedPins.add(property.pin);
				});
			}
		}

		const pointGroups = new Map<string, Reassessment[]>();
		for (const property of properties) {
			if (renderedPins.has(property.pin) || !property.lat || !property.lon) {
				continue;
			}
			const key = `${property.lat.toFixed(6)},${property.lon.toFixed(6)}`;
			const rows = pointGroups.get(key) || [];
			rows.push(property);
			pointGroups.set(key, rows);
		}

		for (const group of pointGroups.values()) {
			const center: [number, number] = [
				group[0].lat as number,
				group[0].lon as number,
			];
			group.forEach((property, index) => {
				addPointMarker(
					layer,
					renderer,
					property,
					offsetLatLng(center, index, group.length),
				);
			});
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
