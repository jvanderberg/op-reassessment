export interface AssessmentValue {
	stage: string | null;
	land: number | null;
	building: number | null;
	total: number | null;
	hie: number | null;
}

export interface PropertyCharacteristics {
	[key: string]: string | number | null;
}

export interface Reassessment {
	pin: string;
	address: string;
	city: string;
	state: string;
	zip: string;
	ownerName: string;
	class: string;
	classDescription: string;
	neighborhood: string;
	townshipCode: string;
	townshipName: string;
	lat: number | null;
	lon: number | null;
	coordinateMethod: string;
	parcelPin?: string;
	url: string;
	assessment2025: AssessmentValue;
	assessment2026: AssessmentValue;
	increase: number | null;
	increasePct: number | null;
	primaryCharacteristics: PropertyCharacteristics | null;
	characteristicCards: PropertyCharacteristics[];
}

export type GroupBy = 'neighborhood' | 'class';

export interface SummaryRow {
	label: string;
	count: number;
	avg2025: number;
	avg2026: number;
	avgIncrease: number;
	medianIncrease: number;
	avgIncreasePct: number;
	medianIncreasePct: number;
}
