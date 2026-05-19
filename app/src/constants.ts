export const OAK_PARK_CENTER: [number, number] = [41.885, -87.79];

const currency = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat('en-US');
const MARKET_VALUE_MULTIPLIER = 10;

export function formatCurrency(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) return '—';
	return currency.format(value * MARKET_VALUE_MULTIPLIER);
}

export function formatNumber(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) return '—';
	return number.format(value);
}

export function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) return '—';
	return `${value.toFixed(1)}%`;
}

export const INCREASE_LEGEND = [
	{ id: 'none', label: 'No data', color: '#737373' },
	{ id: 'lt10', label: '< 10%', color: '#2c7bb6' },
	{ id: '10-20', label: '10-20%', color: '#00a6ca' },
	{ id: '20-30', label: '20-30%', color: '#90eb9d' },
	{ id: '30-40', label: '30-40%', color: '#ffffbf' },
	{ id: '40-50', label: '40-50%', color: '#fdae61' },
	{ id: 'gte50', label: '50%+', color: '#d7191c' },
];

export type IncreaseLegendId = (typeof INCREASE_LEGEND)[number]['id'];

export function increaseLegendId(
	value: number | null | undefined,
): IncreaseLegendId {
	if (value === null || value === undefined || Number.isNaN(value))
		return 'none';
	if (value < 10) return 'lt10';
	if (value < 20) return '10-20';
	if (value < 30) return '20-30';
	if (value < 40) return '30-40';
	if (value < 50) return '40-50';
	return 'gte50';
}

export function increaseColor(value: number | null | undefined): string {
	const id = increaseLegendId(value);
	return INCREASE_LEGEND.find((item) => item.id === id)?.color ?? '#737373';
}
