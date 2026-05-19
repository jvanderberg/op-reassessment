import type { FeatureCollection } from 'geojson';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
	BoundaryLayer,
	HighlightMarker,
	MapBounds,
	ReassessmentMarkers,
} from './components/MapLayers';
import { SearchInput } from './components/SearchInput';
import {
	formatCurrency,
	formatNumber,
	formatPercent,
	INCREASE_LEGEND,
	type IncreaseLegendId,
	increaseLegendId,
	OAK_PARK_CENTER,
} from './constants';
import type { GroupBy, Reassessment, SummaryRow } from './types';

function median(values: number[]) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1] + sorted[mid]) / 2
		: sorted[mid];
}

function average(values: number[]) {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values: number[]) {
	return values.reduce((total, value) => total + value, 0);
}

function aggregateIncreasePct(rows: Reassessment[]) {
	const base = sum(rows.map((row) => row.assessment2025.total || 0));
	const increase = sum(
		rows
			.map((row) => row.increase)
			.filter((value): value is number => value !== null),
	);
	return base > 0 ? (increase / base) * 100 : 0;
}

function groupLabel(property: Reassessment, groupBy: GroupBy) {
	if (groupBy === 'class') {
		return `${property.class} ${property.classDescription}`;
	}
	return property.neighborhood || 'Unknown';
}

function buildSummary(
	properties: Reassessment[],
	groupBy: GroupBy,
): SummaryRow[] {
	const groups = new Map<string, Reassessment[]>();
	for (const property of properties) {
		const key = groupLabel(property, groupBy);
		const rows = groups.get(key) || [];
		rows.push(property);
		groups.set(key, rows);
	}

	const rows = [...groups.entries()].map(([label, rows]) => {
		const increases = rows
			.map((row) => row.increase)
			.filter((value): value is number => value !== null);
		const pctIncreases = rows
			.map((row) => row.increasePct)
			.filter((value): value is number => value !== null);
		return {
			label,
			count: rows.length,
			avg2025: average(rows.map((row) => row.assessment2025.total || 0)),
			avg2026: average(rows.map((row) => row.assessment2026.total || 0)),
			avgIncrease: average(increases),
			medianIncrease: median(increases),
			avgIncreasePct: aggregateIncreasePct(rows),
			medianIncreasePct: median(pctIncreases),
		};
	});

	return rows.sort((a, b) => parseInt(a.label, 10) - parseInt(b.label, 10));
}

function useSystemDarkMode() {
	const [isDark, setIsDark] = useState(() => {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	});

	useEffect(() => {
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const syncTheme = () => {
			const nextIsDark = media.matches;
			setIsDark(nextIsDark);
			document.documentElement.classList.toggle('dark', nextIsDark);
			document.documentElement.style.colorScheme = nextIsDark
				? 'dark'
				: 'light';
		};

		syncTheme();
		media.addEventListener('change', syncTheme);
		return () => media.removeEventListener('change', syncTheme);
	}, []);

	return isDark;
}

export default function App() {
	const isDarkMode = useSystemDarkMode();
	const [properties, setProperties] = useState<Reassessment[]>([]);
	const [boundary, setBoundary] = useState<FeatureCollection | null>(null);
	const [parcels, setParcels] = useState<FeatureCollection | null>(null);
	const [selectedClasses, setSelectedClasses] = useState<Set<string>>(
		new Set(),
	);
	const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<
		Set<string>
	>(new Set());
	const [groupBy, setGroupBy] = useState<GroupBy>('neighborhood');
	const [classFiltersOpen, setClassFiltersOpen] = useState(true);
	const [neighborhoodFiltersOpen, setNeighborhoodFiltersOpen] = useState(true);
	const [selectedLegendBins, setSelectedLegendBins] = useState<
		Set<IncreaseLegendId>
	>(new Set(INCREASE_LEGEND.map((item) => item.id)));
	const [highlightedProperty, setHighlightedProperty] =
		useState<Reassessment | null>(null);

	useEffect(() => {
		const base = import.meta.env.BASE_URL;
		Promise.all([
			fetch(`${base}reassessments.json`).then((r) => r.json()),
			fetch(`${base}boundary.geojson`).then((r) => r.json()),
			fetch(`${base}parcels.geojson`).then((r) => r.json()),
		]).then(([props, bound, parcs]) => {
			setProperties(props);
			setBoundary(bound);
			setParcels(parcs);
		});
	}, []);

	const classMetadata = useMemo(() => {
		const classes = new Map<string, string>();
		for (const property of properties) {
			classes.set(property.class, property.classDescription);
		}
		return [...classes.entries()]
			.map(([code, description]) => ({ code, description }))
			.sort((a, b) => Number(a.code) - Number(b.code));
	}, [properties]);

	const neighborhoodMetadata = useMemo(() => {
		const neighborhoods = new Set<string>();
		for (const property of properties) {
			neighborhoods.add(property.neighborhood || 'Unknown');
		}
		return [...neighborhoods].sort((a, b) => a.localeCompare(b));
	}, [properties]);

	const didInit = useRef(false);
	useEffect(() => {
		if (didInit.current || properties.length === 0) return;
		didInit.current = true;
		setSelectedClasses(new Set(classMetadata.map((option) => option.code)));
		setSelectedNeighborhoods(new Set(neighborhoodMetadata));
	}, [classMetadata, neighborhoodMetadata, properties.length]);

	const classOptions = useMemo(() => {
		const counts = new Map(classMetadata.map((option) => [option.code, 0]));
		for (const property of properties) {
			if (selectedNeighborhoods.has(property.neighborhood || 'Unknown')) {
				counts.set(property.class, (counts.get(property.class) || 0) + 1);
			}
		}
		return classMetadata.map((option) => ({
			...option,
			count: counts.get(option.code) || 0,
		}));
	}, [classMetadata, properties, selectedNeighborhoods]);

	const neighborhoodOptions = useMemo(() => {
		const counts = new Map(neighborhoodMetadata.map((code) => [code, 0]));
		for (const property of properties) {
			if (selectedClasses.has(property.class)) {
				const nbhd = property.neighborhood || 'Unknown';
				counts.set(nbhd, (counts.get(nbhd) || 0) + 1);
			}
		}
		return neighborhoodMetadata.map((code) => ({
			code,
			count: counts.get(code) || 0,
		}));
	}, [neighborhoodMetadata, properties, selectedClasses]);

	const displayed = useMemo(() => {
		return properties.filter(
			(property) =>
				selectedClasses.has(property.class) &&
				selectedNeighborhoods.has(property.neighborhood || 'Unknown'),
		);
	}, [properties, selectedClasses, selectedNeighborhoods]);

	const summary = useMemo(
		() => buildSummary(displayed, groupBy),
		[displayed, groupBy],
	);

	const mapDisplayed = useMemo(() => {
		return displayed.filter((property) =>
			selectedLegendBins.has(increaseLegendId(property.increasePct)),
		);
	}, [displayed, selectedLegendBins]);

	const totals = useMemo(() => {
		const increases = displayed
			.map((property) => property.increase)
			.filter((value): value is number => value !== null);
		const pctIncreases = displayed
			.map((property) => property.increasePct)
			.filter((value): value is number => value !== null);
		return {
			count: displayed.length,
			avgIncrease: average(increases),
			medianIncrease: median(increases),
			avgIncreasePct: aggregateIncreasePct(displayed),
			medianIncreasePct: median(pctIncreases),
		};
	}, [displayed]);

	function toggleClass(code: string) {
		setSelectedClasses((prev) => {
			const next = new Set(prev);
			if (next.has(code)) next.delete(code);
			else next.add(code);
			return next;
		});
	}

	function toggleNeighborhood(code: string) {
		setSelectedNeighborhoods((prev) => {
			const next = new Set(prev);
			if (next.has(code)) next.delete(code);
			else next.add(code);
			return next;
		});
	}

	function toggleLegendBin(id: IncreaseLegendId) {
		setSelectedLegendBins((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	return (
		<div className="flex h-screen w-screen bg-background text-foreground">
			<aside className="w-96 shrink-0 border-r border-border bg-background overflow-y-auto p-4 flex flex-col gap-4">
				<div>
					<h1 className="text-lg font-semibold">
						Oak Park Residential Reassessment
					</h1>
					<p className="text-xs text-muted-foreground">
						2026 mailed market values compared with final 2025 market values
					</p>
				</div>

				<SearchInput
					properties={properties}
					onHighlight={setHighlightedProperty}
				/>

				<div className="grid grid-cols-2 gap-2">
					<div className="rounded-md border border-border p-3">
						<div className="text-xs text-muted-foreground">
							Average Increase
						</div>
						<div className="text-base font-semibold">
							{formatCurrency(totals.avgIncrease)}
						</div>
						<div className="text-xs text-muted-foreground">
							{formatPercent(totals.avgIncreasePct)}
						</div>
					</div>
					<div className="rounded-md border border-border p-3">
						<div className="text-xs text-muted-foreground">Median Increase</div>
						<div className="text-base font-semibold">
							{formatCurrency(totals.medianIncrease)}
						</div>
						<div className="text-xs text-muted-foreground">
							{formatPercent(totals.medianIncreasePct)}
						</div>
					</div>
				</div>

				<section className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<button
							type="button"
							className="flex min-w-0 items-center gap-1 text-sm font-medium"
							aria-expanded={classFiltersOpen}
							onClick={() => setClassFiltersOpen((open) => !open)}
						>
							<ChevronRight
								className={`size-4 shrink-0 transition-transform ${classFiltersOpen ? 'rotate-90' : ''}`}
							/>
							<span>Property Class</span>
							<span className="text-xs font-normal text-muted-foreground">
								{formatNumber(selectedClasses.size)} /{' '}
								{formatNumber(classOptions.length)}
							</span>
						</button>
						<div className="flex shrink-0 gap-2 text-xs">
							<button
								type="button"
								className="text-primary underline"
								onClick={() =>
									setSelectedClasses(
										new Set(classOptions.map((option) => option.code)),
									)
								}
							>
								All
							</button>
							<button
								type="button"
								className="text-primary underline"
								onClick={() => setSelectedClasses(new Set())}
							>
								None
							</button>
						</div>
					</div>
					{classFiltersOpen && (
						<div className="max-h-44 overflow-y-auto rounded-md border border-border p-2">
							{classOptions.map((option) => (
								<div key={option.code} className="flex items-center gap-2 py-1">
									<Checkbox
										id={`class-${option.code}`}
										checked={selectedClasses.has(option.code)}
										onCheckedChange={() => toggleClass(option.code)}
									/>
									<Label
										htmlFor={`class-${option.code}`}
										className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs"
										title={`${option.code} ${option.description}`}
									>
										<span className="font-medium">{option.code}</span>
										<span className="truncate text-muted-foreground">
											{option.description}
										</span>
										<span className="ml-auto text-muted-foreground">
											{formatNumber(option.count)}
										</span>
									</Label>
								</div>
							))}
						</div>
					)}
				</section>

				<section className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<button
							type="button"
							className="flex min-w-0 items-center gap-1 text-sm font-medium"
							aria-expanded={neighborhoodFiltersOpen}
							onClick={() => setNeighborhoodFiltersOpen((open) => !open)}
						>
							<ChevronRight
								className={`size-4 shrink-0 transition-transform ${neighborhoodFiltersOpen ? 'rotate-90' : ''}`}
							/>
							<span>Neighborhood</span>
							<span className="text-xs font-normal text-muted-foreground">
								{formatNumber(selectedNeighborhoods.size)} /{' '}
								{formatNumber(neighborhoodOptions.length)}
							</span>
						</button>
						<div className="flex shrink-0 gap-2 text-xs">
							<button
								type="button"
								className="text-primary underline"
								onClick={() =>
									setSelectedNeighborhoods(
										new Set(neighborhoodOptions.map((option) => option.code)),
									)
								}
							>
								All
							</button>
							<button
								type="button"
								className="text-primary underline"
								onClick={() => setSelectedNeighborhoods(new Set())}
							>
								None
							</button>
						</div>
					</div>
					{neighborhoodFiltersOpen && (
						<div className="grid max-h-40 grid-cols-2 gap-x-3 overflow-y-auto rounded-md border border-border p-2">
							{neighborhoodOptions.map((option) => (
								<div key={option.code} className="flex items-center gap-2 py-1">
									<Checkbox
										id={`nbhd-${option.code}`}
										checked={selectedNeighborhoods.has(option.code)}
										onCheckedChange={() => toggleNeighborhood(option.code)}
									/>
									<Label
										htmlFor={`nbhd-${option.code}`}
										className="flex flex-1 cursor-pointer items-center justify-between text-xs"
										title={`Neighborhood ${option.code}`}
									>
										<span>{option.code}</span>
										<span className="text-muted-foreground">
											{formatNumber(option.count)}
										</span>
									</Label>
								</div>
							))}
						</div>
					)}
				</section>

				<section className="flex min-h-64 flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<div className="text-sm font-medium">Summary</div>
						<div className="flex items-center gap-2">
							<Badge variant="secondary">
								{formatNumber(displayed.length)} /{' '}
								{formatNumber(properties.length)}
							</Badge>
							<Button
								type="button"
								variant={groupBy === 'neighborhood' ? 'default' : 'outline'}
								size="sm"
								onClick={() => setGroupBy('neighborhood')}
							>
								Neighborhood
							</Button>
							<Button
								type="button"
								variant={groupBy === 'class' ? 'default' : 'outline'}
								size="sm"
								onClick={() => setGroupBy('class')}
							>
								Class
							</Button>
						</div>
					</div>
					<div className="overflow-auto rounded-md border border-border">
						<table className="w-full text-xs">
							<thead className="sticky top-0 bg-muted">
								<tr className="border-b border-border text-left">
									<th className="p-2 font-medium">Group</th>
									<th className="p-2 text-right font-medium">Count</th>
									<th className="p-2 text-right font-medium">Avg Inc</th>
									<th className="p-2 text-right font-medium">Med Inc</th>
								</tr>
							</thead>
							<tbody>
								{summary.map((row) => (
									<tr key={row.label} className="border-b border-border/60">
										<td className="max-w-40 truncate p-2" title={row.label}>
											{row.label}
										</td>
										<td className="p-2 text-right">
											{formatNumber(row.count)}
										</td>
										<td className="p-2 text-right">
											<div>{formatCurrency(row.avgIncrease)}</div>
											<div className="text-muted-foreground">
												{formatPercent(row.avgIncreasePct)}
											</div>
										</td>
										<td className="p-2 text-right">
											<div>{formatCurrency(row.medianIncrease)}</div>
											<div className="text-muted-foreground">
												{formatPercent(row.medianIncreasePct)}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			</aside>

			<main className="relative flex-1">
				<MapContainer
					center={OAK_PARK_CENTER}
					zoom={14}
					maxZoom={19}
					className="h-full w-full"
					preferCanvas={true}
				>
					<TileLayer
						key={isDarkMode ? 'dark-tiles' : 'light-tiles'}
						attribution="&copy; OpenStreetMap contributors &copy; CARTO"
						url={
							isDarkMode
								? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
								: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
						}
					/>
					<MapBounds properties={properties.filter((p) => p.lat && p.lon)} />
					{boundary && (
						<BoundaryLayer boundary={boundary} isDarkMode={isDarkMode} />
					)}
					<ReassessmentMarkers properties={mapDisplayed} parcels={parcels} />
					<HighlightMarker
						property={highlightedProperty}
						isDarkMode={isDarkMode}
					/>
				</MapContainer>
				<div className="absolute bottom-4 left-4 z-[500] rounded-md border border-border bg-background/95 p-3 text-xs shadow-sm">
					<div className="mb-2 flex items-center justify-between gap-3">
						<span className="font-medium">Increase</span>
						<button
							type="button"
							className="text-muted-foreground underline hover:text-foreground"
							onClick={() =>
								setSelectedLegendBins(
									new Set(INCREASE_LEGEND.map((item) => item.id)),
								)
							}
						>
							All
						</button>
					</div>
					{INCREASE_LEGEND.map((item) => (
						<button
							key={item.id}
							type="button"
							className={`flex w-full items-center gap-2 rounded-sm py-0.5 text-left hover:bg-muted ${
								selectedLegendBins.has(item.id) ? '' : 'opacity-35'
							}`}
							aria-pressed={selectedLegendBins.has(item.id)}
							onClick={() => toggleLegendBin(item.id)}
						>
							<span
								className="h-3 w-5 rounded-sm"
								style={{ backgroundColor: item.color }}
							/>
							<span>{item.label}</span>
						</button>
					))}
				</div>
			</main>
		</div>
	);
}
