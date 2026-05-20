#!/usr/bin/env node
/**
 * Extract Oak Park 2026 residential reassessments from the tax_appeal_app DB.
 *
 * The source database is opened read-only. By default, this writes all static
 * datasets served by the app:
 *   - app/public/reassessments.json
 *   - app/public/parcels.geojson
 *   - app/public/boundary.geojson
 *
 * Pass --skip-map-data for a fast reassessment-only refresh.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const turfUnion = require('@turf/union').default;

const RESIDENTIAL_CLASSES = [
	'202',
	'203',
	'204',
	'205',
	'206',
	'207',
	'208',
	'209',
	'210',
	'211',
	'234',
	'278',
	'295',
	'299',
];

const ARCGIS_PARCELS_URL =
	'https://gis.cookcountyil.gov/hosting/rest/services/Hosted/Parcel_2022/FeatureServer/0/query';

const ARCGIS_CENSUS_TRACTS_URL =
	'https://utility.arcgis.com/usrsvcs/servers/4cff1aaefa364b57b8c70d5c606f2088/rest/services/VOP/AGOL_VOP_Project/MapServer/159/query';

function parseArgs() {
	const args = process.argv.slice(2);
	const opts = {
		db: '/Users/joshv/git/tax_appeal_app/data/properties.db',
		outputDir: 'app/public',
		skipMapData: false,
	};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--db':
				opts.db = args[++i];
				break;
			case '--output-dir':
			case '-o':
				opts.outputDir = args[++i];
				break;
			case '--skip-map-data':
				opts.skipMapData = true;
				break;
			case '--help':
			case '-h':
				console.log(`Usage:
  node extract-reassessments.cjs
  node extract-reassessments.cjs --db <path>
  node extract-reassessments.cjs --output-dir app/public
  node extract-reassessments.cjs --skip-map-data`);
				process.exit(0);
		}
	}

	return opts;
}

function selectedAssessment(row, prefix) {
	const stages = [
		['board', 'Board of Review'],
		['certified', 'Certified'],
		['mailed', 'Mailed'],
	];

	for (const [key, label] of stages) {
		const total = row[`${prefix}_${key}_tot`];
		if (total !== null && total !== undefined) {
			return {
				stage: label,
				land: row[`${prefix}_${key}_land`],
				building: row[`${prefix}_${key}_bldg`],
				total,
				hie: row[`${prefix}_${key}_hie`],
			};
		}
	}

	return { stage: null, land: null, building: null, total: null, hie: null };
}

function cleanRow(row) {
	const out = {};
	for (const [key, value] of Object.entries(row)) {
		out[key] = value === undefined ? null : value;
	}
	return out;
}

function stripUnit(addr) {
	const streetTypes = /\b(AVE|ST|BLVD|CT|DR|PL|RD|TER|WAY|LN|CIR)\b/i;
	const match = addr?.match(streetTypes);
	if (match) return addr.substring(0, match.index + match[0].length).trim();
	return addr || '';
}

function buildCoordResolver(db) {
	const directLookup = db.prepare(
		'SELECT lat, lon FROM address_points WHERE pin = ?',
	);
	const parentLookup = db.prepare(
		'SELECT lat, lon FROM address_points WHERE pin = ?',
	);
	const addrRows = db
		.prepare(
			"SELECT UPPER(address) as addr, lat, lon FROM address_points WHERE upper(city) = 'OAK PARK'",
		)
		.all();
	const addrMap = new Map();
	for (const row of addrRows) {
		if (!addrMap.has(row.addr)) addrMap.set(row.addr, row);
	}

	return function resolve(pin, address) {
		const direct = directLookup.get(pin);
		if (direct?.lat && direct?.lon) {
			return { lat: direct.lat, lon: direct.lon, method: 'direct' };
		}

		const parentPin = `${pin.substring(0, 10)}0000`;
		if (parentPin !== pin) {
			const parent = parentLookup.get(parentPin);
			if (parent?.lat && parent?.lon) {
				return { lat: parent.lat, lon: parent.lon, method: 'parent_pin' };
			}
		}

		const base = stripUnit(address).toUpperCase();
		const matched = addrMap.get(base);
		if (matched?.lat && matched?.lon) {
			return { lat: matched.lat, lon: matched.lon, method: 'address' };
		}

		return { lat: null, lon: null, method: 'none' };
	};
}

async function fetchVillageBoundary() {
	const params = new URLSearchParams({
		where: '1=1',
		outFields: 'NAME',
		f: 'geojson',
		returnGeometry: 'true',
	});

	console.log('Fetching Oak Park boundary...');
	const resp = await fetch(`${ARCGIS_CENSUS_TRACTS_URL}?${params}`);
	if (!resp.ok) throw new Error(`ArcGIS boundary fetch failed: ${resp.status}`);

	const geojson = await resp.json();
	const merged = turfUnion(geojson);
	return {
		type: 'FeatureCollection',
		features: [{ ...merged, properties: { NAME: 'Oak Park' } }],
	};
}

async function fetchParcelGeometries(properties) {
	const batchSize = 500;
	const features = [];
	const missing = [];
	const pins = properties.map((p) => p.pin);

	console.log(`Fetching parcel geometries for ${pins.length} properties...`);
	for (let i = 0; i < pins.length; i += batchSize) {
		const batch = pins.slice(i, i + batchSize);
		const where = `name IN (${batch.map((p) => `'${p}'`).join(',')})`;
		const body = new URLSearchParams({
			where,
			outFields: 'name',
			outSR: '4326',
			f: 'geojson',
		});

		const resp = await fetch(ARCGIS_PARCELS_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});
		if (!resp.ok) throw new Error(`Parcel fetch failed: ${resp.status}`);

		const geojson = await resp.json();
		features.push(...geojson.features);
		const found = new Set(geojson.features.map((f) => f.properties.name));
		for (const pin of batch) {
			if (!found.has(pin)) missing.push(pin);
		}

		const pct = Math.min(100, Math.round(((i + batch.length) / pins.length) * 100));
		process.stdout.write(`\r  ${features.length} parcels fetched (${pct}%)`);
	}
	console.log(`\n  ${features.length} parcel geometries fetched, ${missing.length} missing`);

	const byPin = new Map(properties.map((p) => [p.pin, p]));
	for (const feature of features) {
		const reassessment = byPin.get(feature.properties.name);
		if (!reassessment) continue;
		feature.properties = {
			...feature.properties,
			pin: reassessment.pin,
			address: reassessment.address,
			class: reassessment.class,
			neighborhood: reassessment.neighborhood,
			increasePct: reassessment.increasePct,
			increase: reassessment.increase,
		};
	}

	return { type: 'FeatureCollection', features };
}

async function main() {
	const opts = parseArgs();
	if (!fs.existsSync(opts.db)) {
		throw new Error(`Database not found: ${opts.db}`);
	}

	console.log('Extract Oak Park 2026 Reassessments');
	console.log('====================================\n');
	console.log(`Source DB: ${opts.db}`);

	const db = new Database(opts.db, { readonly: true });
	const classList = RESIDENTIAL_CLASSES.map((cls) => `'${cls}'`).join(',');

	const rows = db
		.prepare(`
			SELECT
				a26.pin,
				a26.class,
				a26.township_code,
				a26.township_name,
				a26.nbhd,
				cls.description AS class_description,
				pa.prop_address_full,
				pa.prop_address_city_name,
				pa.prop_address_state,
				pa.prop_address_zipcode_1,
				pa.mail_address_name,
				pa.mail_address_full,
				pa.mail_address_city_name,
				pa.mail_address_state,
				pa.mail_address_zipcode_1,
				a26.mailed_bldg AS y2026_mailed_bldg,
				a26.mailed_land AS y2026_mailed_land,
				a26.mailed_tot AS y2026_mailed_tot,
				a26.mailed_hie AS y2026_mailed_hie,
				a26.certified_bldg AS y2026_certified_bldg,
				a26.certified_land AS y2026_certified_land,
				a26.certified_tot AS y2026_certified_tot,
				a26.certified_hie AS y2026_certified_hie,
				a26.board_bldg AS y2026_board_bldg,
				a26.board_land AS y2026_board_land,
				a26.board_tot AS y2026_board_tot,
				a26.board_hie AS y2026_board_hie,
				a25.mailed_bldg AS y2025_mailed_bldg,
				a25.mailed_land AS y2025_mailed_land,
				a25.mailed_tot AS y2025_mailed_tot,
				a25.mailed_hie AS y2025_mailed_hie,
				a25.certified_bldg AS y2025_certified_bldg,
				a25.certified_land AS y2025_certified_land,
				a25.certified_tot AS y2025_certified_tot,
				a25.certified_hie AS y2025_certified_hie,
				a25.board_bldg AS y2025_board_bldg,
				a25.board_land AS y2025_board_land,
				a25.board_tot AS y2025_board_tot,
				a25.board_hie AS y2025_board_hie
			FROM assessed_values a26
			JOIN assessed_values a25 ON a25.pin = a26.pin AND a25.year = 2025
			JOIN parcel_addresses pa ON pa.pin = a26.pin AND pa.year = 2026
			LEFT JOIN property_classes cls ON cls.class = a26.class
			WHERE a26.year = 2026
				AND upper(pa.prop_address_city_name) = 'OAK PARK'
				AND a26.class IN (${classList})
			ORDER BY pa.prop_address_full, a26.pin
		`)
		.all();

	const characteristicRows = db
		.prepare(`
			SELECT pc.*
			FROM property_characteristics pc
			JOIN assessed_values a26 ON a26.pin = pc.pin AND a26.year = 2026
			JOIN parcel_addresses pa ON pa.pin = a26.pin AND pa.year = 2026
			WHERE pc.year = 2026
				AND upper(pa.prop_address_city_name) = 'OAK PARK'
				AND a26.class IN (${classList})
			ORDER BY pc.pin, pc.card
		`)
		.all();

	const cardsByPin = new Map();
	for (const card of characteristicRows) {
		const cards = cardsByPin.get(card.pin) || [];
		cards.push(cleanRow(card));
		cardsByPin.set(card.pin, cards);
	}

	const resolveCoords = buildCoordResolver(db);
	const methodCounts = { direct: 0, parent_pin: 0, address: 0, none: 0 };

	const properties = rows.map((row) => {
		const y2025 = selectedAssessment(row, 'y2025');
		const y2026 = selectedAssessment(row, 'y2026');
		const increase =
			y2025.total !== null && y2026.total !== null ? y2026.total - y2025.total : null;
		const increasePct =
			increase !== null && y2025.total ? (increase / y2025.total) * 100 : null;
		const coords = resolveCoords(row.pin, row.prop_address_full);
		methodCounts[coords.method]++;
		const cards = cardsByPin.get(row.pin) || [];
		const primaryCharacteristics = cards.find((card) => card.card === 1) || cards[0] || null;

		return {
			pin: row.pin,
			address: row.prop_address_full || '',
			city: row.prop_address_city_name || '',
			state: row.prop_address_state || '',
			zip: row.prop_address_zipcode_1 || '',
			ownerName: row.mail_address_name || '',
			class: row.class,
			classDescription: row.class_description || '',
			neighborhood: row.nbhd || '',
			townshipCode: row.township_code || '',
			townshipName: row.township_name || '',
			lat: coords.lat,
			lon: coords.lon,
			coordinateMethod: coords.method,
			url: `https://www.cookcountyassessor.com/pin/${row.pin}`,
			assessment2025: y2025,
			assessment2026: y2026,
			increase,
			increasePct,
			primaryCharacteristics,
			characteristicCards: cards,
		};
	});

	db.close();

	fs.mkdirSync(opts.outputDir, { recursive: true });

	const reassessmentsPath = path.join(opts.outputDir, 'reassessments.json');
	fs.writeFileSync(reassessmentsPath, JSON.stringify(properties));

	if (!opts.skipMapData) {
		const boundary = await fetchVillageBoundary();
		const boundaryPath = path.join(opts.outputDir, 'boundary.geojson');
		fs.writeFileSync(boundaryPath, JSON.stringify(boundary));
		console.log(`  Wrote ${path.resolve(boundaryPath)}`);

		const mappable = properties.filter((p) => p.lat && p.lon);
		const parcels = await fetchParcelGeometries(mappable);
		const parcelsPath = path.join(opts.outputDir, 'parcels.geojson');
		fs.writeFileSync(parcelsPath, JSON.stringify(parcels));
		console.log(`  Wrote ${path.resolve(parcelsPath)}`);
	}

	const withCoordinates = properties.filter((p) => p.lat && p.lon).length;
	console.log('\nDone');
	console.log(`  Reassessments: ${properties.length}`);
	console.log(`  With coordinates: ${withCoordinates}`);
	console.log(`  Coordinate methods: ${JSON.stringify(methodCounts)}`);
	console.log(`  Wrote ${path.resolve(reassessmentsPath)}`);
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
