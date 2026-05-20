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

The reference implementation in this repository overlays Cook County
Assessor reassessment values onto Oak Park parcel geometry and lets users
compare year-over-year market value changes by neighborhood and class.

## App Stack

Keep the stack small and use the latest stable versions that interoperate:

- **Build/runtime**: Vite + TypeScript, React 19, Node 20+ for the
  extract pipeline.
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite`), `tw-animate-css`
  for keyframes, `@fontsource-variable/geist` for typography, `clsx` +
  `tailwind-merge` for class composition.
- **Components**: shadcn/ui on Radix primitives, `lucide-react` for icons,
  `class-variance-authority` for variants. Components are vendored into
  `app/src/components/ui` so they can be tweaked in place.
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
  `app/public/`. `better-sqlite3` for local SQLite sources.
- **Quality**: Biome for lint + format (tabs, single quotes), TypeScript
  strict, a `check.cjs` wrapper exposed as `npm run check` / `check:fix`.
- **Deploy**: static hosting (GitHub Pages, Cloudflare Pages, S3+CDN). No
  server, no API at runtime — the extract step is the backend.

## Style Guide

Based on the patterns in `app/src/index.css` and `app/src/App.tsx`.

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

## Data Sources

Three categories of input feed the recipe. The reference app pulls all
three from Cook County, but the pattern generalizes.

### 1. Tabular records (the spine)

- **Reference dataset**: Cook County Assessor *Assessed Values* and
  *Parcel Addresses* on the Socrata open data portal
  (`datacatalog.cookcountyil.gov`), mirrored locally in a SQLite DB
  (`tax_appeal_app/data/properties.db`).
- **Provenance**: government open-data portal; identifier is the 14-digit
  Property Index Number (PIN). Each row is one parcel-year.
- **Extraction**: `extract-reassessments.cjs` opens the SQLite DB
  read-only, joins `assessed_values` (year 2026 ↔ year 2025) with
  `parcel_addresses` and `property_classes`, filters to Oak Park +
  residential class codes, picks the latest available assessment stage
  (board → certified → mailed), and emits `reassessments.json`.

### 2. Geospatial geometry (the picture)

- **Parcels**: Cook County GIS `Parcel_2022` FeatureServer, queried in
  batches of 500 PINs over HTTP with `where name IN (…)`, returned as
  GeoJSON in EPSG:4326. The script enriches each feature's `properties`
  with the joined record fields so the renderer never has to look the
  record up again at draw time.
- **Boundary**: a single polygon for the jurisdiction (Oak Park),
  fetched from the Village's ArcGIS portal and unioned with
  `@turf/union` so the village outline is one feature, not many.

### 3. Coordinate reference (the bridge)

- **Address points**: a third dataset (`address_points`) keyed by PIN
  with lat/lon. Used when a record can't be matched directly to a
  parcel polygon (condos, vacant land, exempt parcels — about 7% of
  rows in the reference app).

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
4. **Drop with a counter** — keep a `methodCounts` tally so you can
   report how many records were placed by each method and how many were
   dropped. Surface the dropped count in the UI (the `InfoButton`
   popover does this) instead of hiding it.

Write the joined output as **two static files**:

- `reassessments.json` — flat array of records, one per entity.
- `parcels.geojson` — `FeatureCollection` where each feature carries
  enough joined fields (`address`, `class`, `increasePct`, etc.) to
  render and popup without a second lookup.

The browser fetches both at startup with `Promise.all`, joins them by
ID into a Map once, and renders from memo'd selectors.

## UX

The goal is a visitor who has never seen the site understanding the
headline finding within ten seconds.

### Lead with the summary

- Two large KPIs above the fold: an **average** and a **median**
  (medians blunt outliers in skewed civic distributions — show both).
- A grouped summary **table** below the KPIs that breaks the population
  down two ways (here: by neighborhood, by class) with a toggle. Keep
  totals live: any filter change updates KPIs, table, and map together.
- Reuse the same currency/percent formatters (`formatCurrency`,
  `formatPercent`) everywhere so the map popup, table, and KPI cards
  agree to the dollar.

### Fluid map interactions

- **Cluster, then expand**: when many records share a parcel or
  coordinate, draw one polygon/circle whose color is the
  *base-weighted* aggregate. Click expands the cluster into a sunflower
  of offset points (golden-angle layout — see `offsetLatLng`) so
  individual units are still selectable.
- **Color-coded legend that filters**: legend swatches are buttons.
  Clicking one isolates that bin on the map *without* changing the
  summary totals — visitors can probe "where are the 50%+ increases?"
  without losing the denominator.
- **Smooth highlight**: search-selected records pan the map and draw a
  ring + dot in the foreground pane (`z-index` 470) above the
  fill, so the chosen record stands out without flashing or bouncing.
- **Canvas renderer** with a dedicated pane (`L.canvas({ pane:
  'markers' })`) keeps tens of thousands of markers responsive on
  mobile.

### Tooltips & help

- Marker tooltips on clusters explain *what* and *how* — "N units, X% to
  Y%. Click to expand." Don't leave the visitor guessing what a circle
  represents.
- Provide an always-visible `?` info button (`InfoButton.tsx` template)
  that opens a popover citing every data source with a link and a
  one-line description, plus a frank disclosure of known gaps
  (e.g. "~7% of properties lack coordinates"). Trust is built by being
  explicit about the seams.
- Hover tooltips on truncated text use the native `title` attribute so
  full class descriptions and neighborhood codes are reachable without
  resizing the panel.

### URL-serialized state

Treat the URL as the source of truth for *view* state so a visitor can
copy the address bar and a colleague sees exactly the same map:

- Serialize selected classes, selected neighborhoods, selected legend
  bins, group-by mode, highlighted PIN, and (optionally) map
  center/zoom into search params (`?class=202,203&nbhd=…&bins=gte50&
  group=class&pin=…`). Use short keys; comma-separate values.
- On load, hydrate the Zustand store from `location.search` before the
  first render so the initial paint matches the link.
- On every relevant state change, debounce a `history.replaceState`
  (not `pushState`, to keep the back button useful) that writes the new
  URL. Don't fire on every keystroke in the search box — only commit
  the highlighted PIN.
- Provide a "Share this view" button that copies the current URL — it's
  the cheapest way to turn a static site into a collaborative tool.

### Animations

- Use `tw-animate-css` for short, functional transitions: drawer slide,
  chevron rotate, popover fade. Keep durations ≤200ms — civic data
  apps should feel taut, not playful.
- Animate the map (`map.setView`) and the marker highlight; never
  animate KPI numbers (it makes them harder to read).
- Respect `prefers-reduced-motion` — wrap non-essential transitions in
  a `@media (prefers-reduced-motion: no-preference)` block.
