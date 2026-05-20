# Civic Geo-Data Explorer Recipe

## Summary

A recipe for building a single-page civic data explorer that overlays one or
more **public records datasets** onto a **map of a defined jurisdiction**,
lets visitors **filter**, **search**, and **summarize** the dataset, and
produces a shareable URL that captures the current view.

Use this recipe when you have a finite, geocoded population — properties on a
tax roll, schools in a district, restaurant inspections in a city, permits in
a ZIP — and you want a fast, static, mobile-friendly site that:

- combines a **tabular records dataset** (the primary entities and their
  attributes) with
- a **geospatial parcel/boundary layer** (polygons or points to draw), and
- a **coordinate/address reference** (so records that don't carry lat/lon can
  still be placed on a map),
- joining them by a stable identifier (PIN, license number, school ID, etc.)
  so the map, summary tables, and search all stay in sync.

A worked example threaded through the Data Sources section applies the
pattern to Cook County, IL property reassessments — annual market
values overlaid on parcel geometry, with year-over-year change as the
headline metric. The pattern transfers to any jurisdiction with
equivalent public datasets.

## App Stack

Keep the stack small and use the latest stable versions that interoperate:

- **Build/runtime**: Vite + TypeScript, React 19, Node 20+ for the
  extract pipeline.
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite`), `tw-animate-css`
  for keyframes, `@fontsource-variable/geist` for typography, `clsx` +
  `tailwind-merge` for class composition.
- **Components**: shadcn/ui on Radix primitives, `lucide-react` for icons,
  `class-variance-authority` for variants. Vendor the shadcn components
  into a local `components/ui/` directory so they can be tweaked in
  place rather than imported from a package.
- **State**: **Zustand** for app-wide state — filters, selected legend bins,
  highlighted record, theme, URL-serialized view. Prefer one store with
  selector slices over deep `useState` trees and prop drilling. Use local
  `useState` only for component-local UI like input focus or popover open
  state.
- **Map**: Leaflet + `react-leaflet`, CARTO light/dark basemap tiles,
  canvas renderer for marker-heavy views.
- **Geo math**: `@turf/*` (union, point-in-polygon, helpers, buffer) in
  the extract step — keep heavy geometry work out of the browser.
- **Data pipeline**: a Node script that reads the source DB / fetches the
  source APIs, normalizes records, and writes static JSON + GeoJSON into
  the Vite `public/` directory. `better-sqlite3` for local SQLite
  sources.
- **Quality**: Biome for lint + format (tabs, single quotes), TypeScript
  strict, and a single `check` / `check:fix` npm script that wraps
  lint + format + typecheck so contributors only learn one command.
- **Deploy**: static hosting (GitHub Pages, Cloudflare Pages, S3+CDN). No
  server, no API at runtime — the extract step is the backend.

## Style Guide

### Theme

- **Light + dark**, driven by the user's `prefers-color-scheme`. Add a
  `dark` class to `<html>` and set `color-scheme` so native form controls
  follow. Persist user overrides in the URL or store, not localStorage,
  so a shared link looks the same on the recipient's screen.
- Color tokens are declared as **OKLCH** CSS variables on `:root` and
  `.dark`, then exposed to Tailwind via `@theme inline`. Use
  `--background`, `--foreground`, `--muted`, `--border`, `--primary`,
  `--accent`, `--destructive`, plus `--chart-1…5` for data viz. Never
  hardcode hex values in components — go through the variable.
- The map basemap, polygon outlines, and highlight markers all branch on
  the same `isDarkMode` flag so the dark theme stays cohesive across
  Leaflet and the chrome.

### Typography & spacing

- One variable font (Geist) loaded via `@fontsource-variable`. One family
  is enough; use weight + size for hierarchy.
- Density tier: `text-xs` for tables and filters, `text-sm` for
  headings/buttons, `text-base` for hero numbers. Avoid more than three
  sizes per pane.
- Radius scale derived from one `--radius` variable
  (`--radius-sm` … `--radius-4xl`).

### Component templates

- **Surfaces**: `rounded-md border border-border bg-background/95
  shadow-sm` for floating panels (legend, mobile stat cards). Drop the
  `/95` when the panel is opaque.
- **Tables**: sticky `<thead>` with `bg-muted`, `border-b border-border`
  between rows, right-aligned numeric columns, secondary metric (e.g.
  percent) rendered in `text-muted-foreground` directly under the
  primary metric.
- **Filter sections**: collapsible header (`ChevronRight` rotates 90°
  when open), an "All / None" pair on the right, and a scrollable
  `max-h-44 overflow-y-auto` body with checkbox + label rows. Show
  `selected / total` counts next to the section title.
- **Buttons**: shadcn variants — `default`, `outline`, `secondary`,
  `ghost`. Active toggles use `default`, inactive use `outline`.
- **Badges**: use for compact counts (e.g. `displayed / total`).
- **Map popups & tooltips**: restyled via `.leaflet-container .leaflet-…`
  selectors to read from the same `--popover`, `--border`,
  `--foreground` tokens so they don't look pasted in.

### Mobile

- Layout in `dvh` units so the iOS toolbar doesn't crop content.
- Sidebar/filter pane is a slide-in drawer on `<md`, a static column on
  `≥md`. Provide an always-visible "Filters" rail tab when the drawer is
  closed so the affordance is discoverable.
- Duplicate the top-level KPIs as a floating two-column card on mobile
  so they remain visible when the drawer is closed.
- Map controls (zoom, legend) live in the bottom-right and bottom-left
  corners — thumb-reachable, never under the drawer trigger.
- Hit targets: 32px minimum (`size-8` / `py-1.5`). Tap-to-expand for
  clustered markers; never rely on hover.

### Accessibility

- **Keyboard nav**: every interactive element reachable in tab order,
  including legend swatches (they're already `<button>` — keep them
  that way) and marker popups (open with Enter, close with Esc). The
  map needs an "skip to map" anchor and arrow-key panning via
  Leaflet's built-in keyboard handler (enabled by default — don't
  disable it).
- **Focus rings**: use the existing `--ring` token; never strip
  `outline` without a replacement. shadcn components ship with
  `focus-visible:ring-2` — keep it.
- **ARIA**: label icon-only buttons (`aria-label="Open filters"`,
  `aria-label="Close filters"`, `aria-label="Clear search"`). Use
  `aria-expanded` on collapsible section headers and `aria-pressed` on
  any toggle button (legend filters, group-by switches, theme toggle).
- **Color is never the only cue**. Pick a **colorblind-safe divergent
  palette** for the legend — a 7-stop ColorBrewer-style ramp works
  well; verify it against deuteranopia and protanopia simulators
  before shipping. Pair color with a textual label in tooltips and a
  numeric range in the legend so the bin is legible without color.
- **Contrast**: text on every surface variable pair must clear WCAG AA
  (4.5:1 for body, 3:1 for large). Re-check after any OKLCH token
  tweak — it's easy to drop `--muted-foreground` below threshold.
- **Reduced motion**: gate the drawer slide, chevron rotate, and map
  fly-to behind `prefers-reduced-motion: no-preference`. Snap, don't
  animate, when the visitor has asked for less motion.

## Data Sources

Three categories of input feed the recipe. The worked example below
pulls all three from Cook County, IL public data services; each
source is documented with its portal page, the machine-readable
endpoint, the query mechanics, the schema fields the pattern relies
on, and the license/attribution — usable on its own as a reference,
and the pattern transfers to any equivalent municipal data sources.

Two source platforms recur and are worth knowing:

- **Socrata Open Data API (SODA)**. Tabular datasets on
  `datacatalog.cookcountyil.gov` and most US municipal portals. Each
  dataset has a 4x4 ID (e.g. `uzyt-m557`); the human page lives at
  `https://<host>/d/<id>` and the JSON endpoint at
  `https://<host>/resource/<id>.json`. Query with SoQL params:
  `$select`, `$where`, `$order`, `$limit` (default 1000, max
  50000), `$offset`. Send `X-App-Token: <token>` to lift throttling —
  register a free app token on the portal. Full field metadata and
  column types are on the dataset page's "Columns" tab and at
  `https://<host>/api/views/<id>.json`.
- **Esri ArcGIS REST FeatureServer / MapServer**. Geospatial layers
  exposed at `.../FeatureServer/<layerId>` or
  `.../MapServer/<layerId>`. Append `?f=pjson` to that URL to read
  the layer's full schema (field names, types, geometry type, spatial
  reference). Append `/query` and POST a form-encoded body with
  `where`, `outFields`, `outSR=4326`, `f=geojson`,
  `returnGeometry=true` to fetch features. Servers cap responses
  (commonly 1000–2000 features) — paginate with
  `resultOffset`/`resultRecordCount`, or batch your `where IN (…)`
  list into chunks of ~500 IDs.

### 1. Tabular records (the spine)

Three Socrata datasets from the Cook County Assessor on
`datacatalog.cookcountyil.gov`. Each is updated on the Assessor's
own cadence (assessed values: annually plus reassessment-cycle
updates; addresses: monthly-ish). License: public domain / open data
per the [Cook County Open Data
Terms](https://datacatalog.cookcountyil.gov/login/terms_of_use).

**1a. Assessed Values** — annual market value, land + building +
total, at each assessment stage.

- Portal: <https://datacatalog.cookcountyil.gov/d/uzyt-m557>
- JSON endpoint: <https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json>
- Schema fields the recipe uses (see portal Columns tab for full list):
  - `pin` (text, 14-digit Property Index Number — **join key**)
  - `year` (number)
  - `class` (text, 3-digit property class code)
  - `township_code`, `township_name`, `nbhd` (text — neighborhood code)
  - `mailed_bldg`, `mailed_land`, `mailed_tot`, `mailed_hie` (number)
  - `certified_bldg`, `certified_land`, `certified_tot`, `certified_hie`
  - `board_bldg`, `board_land`, `board_tot`, `board_hie`
- Query example (all 2026 values for one township, paginated):

  ```
  GET https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json
      ?$where=year=2026 AND township_code='10'
      &$limit=50000
  ```

- Stage selection: pick the latest non-null total per row — board →
  certified → mailed — so you always show the most up-to-date value
  for that PIN/year.

**1b. Parcel Addresses** — situs address and mailing address per
PIN, per year.

- Portal: <https://datacatalog.cookcountyil.gov/d/3723-97qp>
- JSON endpoint: <https://datacatalog.cookcountyil.gov/resource/3723-97qp.json>
- Schema fields used:
  - `pin` (text — **join key**)
  - `year` (number)
  - `prop_address_full`, `prop_address_city_name`,
    `prop_address_state`, `prop_address_zipcode_1` (text — situs)
  - `mail_address_name`, `mail_address_full`,
    `mail_address_city_name`, `mail_address_state`,
    `mail_address_zipcode_1` (text — mailing)

**1c. Property Classes** (lookup) — 3-digit class code to human
description (e.g. `203 = One story residence, any age, 1,001 to
1,800 sq. ft.`). Find the current dataset ID by searching
"property classes" on the portal; load once and join in memory.

**1d. Property Characteristics** (optional, for richer popups) —
square footage, year built, bedroom/bath counts per PIN-year-card.
Use these to flesh out the per-record detail view. Search
"property characteristics" on the same portal to find the current
dataset ID.

### 2. Geospatial geometry (the picture)

Two ArcGIS FeatureServer layers from Cook County GIS.

**2a. Parcel polygons** — the property boundary geometry.

- Layer page: <https://gis.cookcountyil.gov/hosting/rest/services/Hosted/Parcel_2022/FeatureServer/0>
- Schema (full): <https://gis.cookcountyil.gov/hosting/rest/services/Hosted/Parcel_2022/FeatureServer/0?f=pjson>
- Query endpoint:
  <https://gis.cookcountyil.gov/hosting/rest/services/Hosted/Parcel_2022/FeatureServer/0/query>
- Join field: `name` (the 14-digit parcel PIN). Not every assessed
  PIN has a polygon — condos in particular share a building polygon
  under the parent PIN.
- Query mechanics: POST form-encoded
  `where=name IN ('14...','14...',...)&outFields=name&outSR=4326&f=geojson`
  in batches of ~500 PINs (URL length and server limits). Example:

  ```
  POST .../FeatureServer/0/query
  Content-Type: application/x-www-form-urlencoded
  where=name IN ('16071010010000','16071010020000','16071010030000')
  outFields=name
  outSR=4326
  f=geojson
  ```

- Output: GeoJSON `FeatureCollection`; each feature's
  `properties.name` is the PIN. Enrich each feature with the joined
  tabular fields so the browser doesn't need a second lookup.
- License: per Cook County GIS terms of use, attribution required.

**2b. Jurisdiction boundary** — one polygon describing the area
your app covers. Two practical paths, depending on what your
jurisdiction publishes:

- *Path A — published boundary layer*. Most municipalities publish
  their own ArcGIS portal (look for `<city>.hub.arcgis.com` or
  `<city>-open-data.hub.arcgis.com`). Find the layer titled
  "Municipal Boundary", "City Limits", or similar and grab its
  FeatureServer query URL — the layer page lists it under "I want
  to use this" → "View API resources". For the Cook County worked
  example, the Village of Oak Park portal at
  <https://oak-park-open-data-portal-v2-oakparkil.hub.arcgis.com>
  is the source.
- *Path B — union of sub-features*. If no single boundary polygon
  is published, fetch a layer of sub-features that tile the
  jurisdiction (historic districts, census tracts, ZIP polygons) and
  union them with [`@turf/union`](https://turfjs.org/docs/api/union)
  in the extract step. Query the layer with `where=1=1` and
  `f=geojson`, then merge all features into one. Result: one
  `FeatureCollection` with a single feature.
- Whichever path you take, **bake the source URL into the manifest**
  (see Provenance & freshness) so visitors can verify what they're
  looking at.

### 3. Coordinate reference (the bridge)

A PIN → (lat, lon) lookup, used when a record can't be matched to a
parcel polygon. In Cook County this is **Address Points**:

- Portal: <https://datacatalog.cookcountyil.gov/d/78yw-iddh>
- JSON endpoint: <https://datacatalog.cookcountyil.gov/resource/78yw-iddh.json>
- Schema fields used:
  - `pin` (text — join key)
  - `address` (text)
  - `city` (text — filter to your jurisdiction)
  - `lat`, `lon` (number, WGS84)
- Query example (all Oak Park points):

  ```
  GET https://datacatalog.cookcountyil.gov/resource/78yw-iddh.json
      ?$where=upper(city)='OAK PARK'
      &$limit=50000
  ```

- Expect a single-digit percentage of records to need this fallback
  (condos, vacant land, exempt parcels — about 7% in the Cook
  County example). Compute the number at extract time and disclose
  it in your UI; don't hide it.

### Working copy: cache before you query

Hitting Socrata + ArcGIS from a build step is fine for small
datasets but fragile for anything county-scale. The recommended
pattern is a one-time bulk pull into a local SQLite file (hundreds
of MB at county scale) keyed by the join ID, with the extract step
reading from that cache:

- Bulk fetch script that pages through each Socrata dataset
  (`$limit=50000` + `$offset`) and inserts into SQLite tables named
  after the dataset.
- Refresh on a cron (weekly is plenty for slow-moving assessment-
  style data).
- The Socrata `:updated_at` system field on each row lets you do
  incremental pulls: `$where=:updated_at > '<last_run_iso>'`.
- ArcGIS parcel geometry rarely changes — cache it for months.

### Joining heterogeneous sources

Pick **one canonical identifier** per record (PIN here) and resolve
everything else through a deterministic fallback chain:

1. **Exact ID match** against the coordinate source.
2. **Parent ID match** — strip the unit suffix (`pin.substring(0, 10) +
   '0000'`) and look up the parent parcel. Critical for condo buildings
   where each unit has its own record but only the building has a
   geometry.
3. **Normalized address match** — uppercased, with street-type
   suffix-stripped, against an in-memory address map. Last-resort
   fallback for records whose IDs don't appear in any geometry source.
4. **Drop with a counter** — keep a per-method tally so you can
   report how many records were placed by each method and how many
   were dropped. Surface the dropped count in the UI (the data-source
   info popover is the natural home for it) instead of hiding it.

Write the joined output as **two static files** in the static-assets
directory:

- `records.json` — flat array of records, one per entity.
- `geometry.geojson` — `FeatureCollection` where each feature carries
  enough joined fields (address, class, headline metric, etc.) to
  render and popup without a second lookup.

The browser fetches both at startup with `Promise.all`, joins them by
ID into a Map once, and renders from memo'd selectors.

### Provenance & freshness

Civic data goes stale silently. Bake provenance into the build so the
UI can be honest about it:

- Wrap the extract output in a manifest object — `{ generatedAt:
  '2026-05-20T14:00:00Z', sources: { <sourceKey>: { dataset:
  '<id-or-url>', rowCount: 12345, lastModified: '…' }, … }, records:
  [...] }` — or write a sibling `manifest.json` alongside the data
  files. Either works; pick one and stick to it.
- Surface "Data as of *YYYY-MM-DD*" in the title block and again in the
  data-source popover. Make it unmissable.
- The extract step should fail loudly on schema surprises: assert
  expected columns exist, row counts are in a sane range, and at least
  N% of records geocoded by the direct or parent-PIN methods. A silent
  null-flood is worse than a failed build.

## UX

The goal is a visitor who has never seen the site understanding the
headline finding within ten seconds.

### Lead with the summary

- Two large KPIs above the fold: an **average** and a **median**
  (medians blunt outliers in skewed civic distributions — show both).
- A grouped summary **table** below the KPIs that breaks the population
  down two complementary ways (e.g. by neighborhood and by category)
  with a toggle. Keep totals live: any filter change updates KPIs,
  table, and map together.
- Define currency/percent/number formatters once in a shared module
  and reuse them in the map popup, table, and KPI cards so every
  surface agrees to the dollar. Make them tolerant of `null` and
  return a consistent sentinel (`—`).

### Loading, empty, and error states

The three JSON fetches are the longest critical-path operation in the
app. Spec each visible state, don't ship a white screen:

- **Loading**: render the chrome immediately — sidebar shell, KPI
  cards as skeleton blocks, map container with the basemap tiles
  already drawing. Avoid a centered spinner on a blank page; the
  basemap alone gives the visitor a sense of place while data
  arrives.
- **Partial load**: don't block the map on the geometry file if the
  records file is already in hand — draw point markers first, then
  swap to parcel polygons when the geometry arrives. Progressive
  rendering beats a synchronized but slower paint.
- **Empty filter result**: when the active filters select zero
  records, the table and KPIs read the null-display sentinel (`—`)
  and a single-button "Reset filters" appears inline. Don't silently
  show a blank map.
- **Fetch failure**: catch the `Promise.all` rejection and render an
  error card in place of the KPIs with the upstream URL, the HTTP
  status, and a "Retry" button. Link to the data-source popover so
  the visitor can verify the underlying portal is up.

### Fluid map interactions

- **Cluster, then expand**: when many records share a parcel or
  coordinate, draw one polygon/circle whose color is the
  *base-weighted* aggregate. Click expands the cluster into a
  sunflower of offset points — place children around the center on a
  golden-angle (~137.5°) spiral with a radius that grows with
  `sqrt(index)`, so points don't overlap and the layout is
  deterministic — and individual units become selectable.
- **Color-coded legend that filters**: legend swatches are buttons.
  Clicking one isolates that bin on the map *without* changing the
  summary totals — visitors can probe "where are the 50%+ increases?"
  without losing the denominator.
- **Smooth highlight**: search-selected records pan the map and draw a
  ring + dot in a dedicated Leaflet pane stacked above markers, so
  the chosen record stands out without flashing or bouncing.
- **Canvas renderer**: use Leaflet's canvas renderer (`L.canvas({
  pane: 'markers' })`) on a dedicated marker pane to keep tens of
  thousands of points responsive on mobile.

### Tooltips & help

- Marker tooltips on clusters explain *what* and *how* — "N units, X% to
  Y%. Click to expand." Don't leave the visitor guessing what a circle
  represents.
- Provide an always-visible `?` info button that opens a popover with:
  every data source's portal URL and a one-line description, the
  "Data as of *YYYY-MM-DD*" stamp from the manifest, a frank
  disclosure of known gaps (e.g. "~7% of properties lack coordinates
  and aren't shown on the map"), and the source license/attribution
  text where required. Trust is built by being explicit about the
  seams.
- Hover tooltips on truncated text use the native `title` attribute so
  full class descriptions and neighborhood codes are reachable without
  resizing the panel.

### URL-serialized state

Treat the URL as the source of truth for *view* state so a visitor can
copy the address bar and a colleague sees exactly the same map:

- Serialize selected classes, selected neighborhoods, selected legend
  bins, group-by mode, highlighted record ID, and (optionally) map
  center/zoom into search params (`?class=202,203&nbhd=…&bins=gte50&
  group=class&pin=…`). Use short keys; comma-separate values.
- On load, hydrate the Zustand store from `location.search` before the
  first render so the initial paint matches the link.
- On every relevant state change, debounce a `history.replaceState`
  (not `pushState`, to keep the back button useful) that writes the new
  URL. Don't fire on every keystroke in the search box — only commit
  the highlighted ID.
- **Per-record permalink**: `?pin=…` (or whatever the canonical ID is)
  is a first-class entry point. On hydrate, look the record up, pan
  the map to it, draw the highlight ring, and open the popup
  automatically — no extra click. This is the link visitors actually
  share ("here's my property") and it costs almost nothing once URL
  state is already wired.
- Provide a "Share this view" button that copies the current URL, and
  a separate "Share this record" affordance inside the marker popup
  that copies a `?pin=…` permalink — two distinct sharing intents.

### Animations

- Use `tw-animate-css` for short, functional transitions: drawer slide,
  chevron rotate, popover fade. Keep durations ≤200ms — civic data
  apps should feel taut, not playful.
- Animate the map (`map.setView`) and the marker highlight; never
  animate KPI numbers (it makes them harder to read).
- Respect `prefers-reduced-motion` — wrap non-essential transitions in
  a `@media (prefers-reduced-motion: no-preference)` block.

## Testing

This shape of app — data extraction plus visual rendering — doesn't
reward heavy unit coverage. Aim for **tripwires, not coverage**:

- **Extract snapshot test**: hold a small fixture DB (or recorded
  API responses) under `test/fixtures/`, run the extract script
  against it, and snapshot the `records.json` + `geometry.geojson`
  outputs. Any upstream schema drift or extract-logic regression
  shows up as a diff in the next PR. Cheap, durable, catches the bug
  class that matters most.
- **Join-coverage assertion**: as part of the extract, assert that
  ≥X% of records resolve via the direct or parent-ID method (aim
  for ≥90% in production). Fail the build if it drops — silent
  geocoding decay is a real failure mode.
- **Boot smoke test**: a single Playwright (or Vitest + jsdom)
  scenario that loads the app against the committed fixtures, waits
  for the KPI cards to render real values, opens the data-source
  popover, and selects a legend bin. If this passes, the wiring is
  intact.
- **Pure-function unit tests** for the math that drives the headline
  numbers — the median calculator, the base-weighted aggregate
  percent calculator, the legend-bin classifier, and the
  coordinate-resolver fallback chain. These are the functions that,
  if quietly wrong, would mislead every visitor.
- **Visual regression**: optional but worthwhile — a Playwright
  screenshot of the map at a fixed zoom + filter set, gated to
  re-baseline only on intentional UI changes.

Skip: exhaustive component tests, integration tests against live
upstream APIs (flaky, no signal), and snapshot tests of JSX trees
(noise).
