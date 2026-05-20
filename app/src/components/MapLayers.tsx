import type { FeatureCollection } from 'geojson';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
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

function groupTooltip(properties: Reassessment[], expanded: boolean) {
	const pcts = properties
		.map((property) => property.increasePct)
		.filter((value): value is number => value !== null);
	const min = Math.min(...pcts);
	const max = Math.max(...pcts);
	const pctText =
		pcts.length === 0
			? 'No percentage data'
			: Math.abs(max - min) < 0.05
				? formatPercent(min)
				: `${formatPercent(min)} to ${formatPercent(max)}`;
	return `${properties.length} units, ${pctText}. Click to ${
		expanded ? 'collapse' : 'expand'
	}.`;
}

function aggregateIncreasePct(properties: Reassessment[]) {
	let base = 0;
	let increase = 0;
	for (const property of properties) {
		const total2025 = property.assessment2025.total;
		if (total2025 === null || property.increase === null) continue;
		base += total2025;
		increase += property.increase;
	}
	return base > 0 ? (increase / base) * 100 : null;
}

function toggleSetValue(set: Set<string>, key: string) {
	const next = new Set(set);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	return next;
}

function collapsedPointRadius(count: number, zoom: number) {
	const zoomScale = Math.max(0, Math.min(1, (zoom - 13) / 5));
	const countScale = Math.sqrt(count);
	return 3 + zoomScale * Math.min(12, countScale);
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
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const [zoom, setZoom] = useState(() => map.getZoom());

	useEffect(() => {
		const handleZoom = () => setZoom(map.getZoom());
		map.on('zoomend', handleZoom);
		return () => {
			map.off('zoomend', handleZoom);
		};
	}, [map]);

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

		const parcelByPin = new Map<string, GeoJSON.Feature>();
		if (parcels) {
			for (const feature of parcels.features as GeoJSON.Feature[]) {
				const parcelPin = String(
					feature.properties?.parcelPin || feature.properties?.name || '',
				);
				if (parcelPin) parcelByPin.set(parcelPin, feature);
			}
		}

		const parcelGroups = new Map<
			string,
			{ feature: GeoJSON.Feature; properties: Reassessment[] }
		>();
		const pointGroups = new Map<string, Reassessment[]>();

		for (const property of properties) {
			const feature =
				parcelByPin.get(property.pin) ||
				(property.parcelPin ? parcelByPin.get(property.parcelPin) : undefined);
			if (feature) {
				const parcelPin = String(
					feature.properties?.parcelPin ||
						feature.properties?.name ||
						property.parcelPin ||
						property.pin,
				);
				const key = `parcel:${parcelPin}`;
				const group = parcelGroups.get(key) || { feature, properties: [] };
				group.properties.push(property);
				parcelGroups.set(key, group);
				continue;
			}

			if (!property.lat || !property.lon) continue;
			const key = `point:${property.lat.toFixed(6)},${property.lon.toFixed(6)}`;
			const rows = pointGroups.get(key) || [];
			rows.push(property);
			pointGroups.set(key, rows);
		}

		for (const [key, group] of parcelGroups) {
			const latLngs = polygonLatLngs(group.feature);
			if (!latLngs) continue;
			const expanded = expandedGroups.has(key);
			const color = increaseColor(aggregateIncreasePct(group.properties));

			if (group.properties.length === 1) {
				const property = group.properties[0];
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
				continue;
			}

			const center = polygonCenter(group.feature);
			const polygon = L.polygon(
				latLngs as L.LatLngExpression[] | L.LatLngExpression[][],
				{
					color,
					fillColor: color,
					fillOpacity: expanded ? 0.06 : 0.2,
					weight: expanded ? 1 : 2,
					renderer,
					pane: 'markers',
				},
			)
				.bindTooltip(groupTooltip(group.properties, expanded))
				.on('click', () => {
					setExpandedGroups((current) => toggleSetValue(current, key));
				})
				.addTo(layer);

			if (!expanded || !center) {
				continue;
			}

			group.properties.forEach((property, index) => {
				addPointMarker(
					layer,
					renderer,
					property,
					offsetLatLng(center, index, group.properties.length),
				);
			});
			polygon.bringToBack();
		}

		for (const [key, group] of pointGroups) {
			const center: [number, number] = [
				group[0].lat as number,
				group[0].lon as number,
			];
			const expanded = expandedGroups.has(key);
			if (group.length > 1 && !expanded) {
				const color = increaseColor(aggregateIncreasePct(group));
				L.circleMarker(center, {
					radius: collapsedPointRadius(group.length, zoom),
					color,
					fillColor: color,
					fillOpacity: 0.35,
					weight: 2,
					renderer,
					pane: 'markers',
				})
					.bindTooltip(groupTooltip(group, expanded))
					.on('click', () => {
						setExpandedGroups((current) => toggleSetValue(current, key));
					})
					.addTo(layer);
				continue;
			}

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
	}, [properties, parcels, expandedGroups, zoom, map]);

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
