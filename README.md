# BIM Sustainability Analytics — Integrated Building Envelope Design

A BIM-based sustainability dashboard for early-stage building-envelope analysis.
Research context: **"Integrated Building Envelope Design: A BIM-Based Framework for Sustainability."**

The app runs in an explicitly labelled **Analytical / Demo mode**: defensible simplified
steady-state physics for design-direction comparison — not a validated simulation engine.

> **Architecture note:** this is a frontend-only application (React + TypeScript + Vite).
> There is no backend server, no database server, and no API keys to configure.
> "Starting the server" below means starting the Vite web server that serves the app in
> your browser. All BIM parsing, calculations, and persistence happen locally in the
> browser (project saves go to browser localStorage + IndexedDB, not to any server).

---

## 1. Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | Version **18 or newer** (verified with Node v26.8.1). Download from <https://nodejs.org> or use a version manager (`nvm`, `fnm`, `volta`). |
| **npm** | Ships with Node.js (verified with npm 12.0.2). No other package manager is required. |
| **Web browser** | Any current Chrome, Edge, Firefox, or Safari (WebGL required for the 3D viewer). |
| **Operating system** | Windows, macOS, or Linux. Commands below use POSIX shell syntax (`bash`/`zsh`); on Windows use PowerShell or Git Bash with the same `npm` commands. |
| **Network** | Internet access is needed **once** for `npm install`. After that, the dev and production servers run fully offline. |

Check your setup before starting:

```bash
node --version   # expect v18.x.x or newer
npm --version    # expect 8.x.x or newer
```

---

## 2. Installation

1. **Open the project folder** in a terminal (this folder — the one containing
   `package.json`, `src/`, `public/`, and this README):

   ```bash
   cd /path/to/Bim_dashboard
   ```

2. **Install dependencies** (downloads React, Three.js, Recharts, jsPDF, Vite, TypeScript, Vitest into `node_modules/`):

   ```bash
   npm install
   ```

   - This typically takes 1–3 minutes on first run.
   - If you see `npm warn` lines about install scripts being blocked, they are harmless and can be ignored.
   - If installation fails, see [Troubleshooting](#7-troubleshooting).

3. **(Optional) Run the test suite** to confirm the calculation engine, IFC parser,
   and CSV importer work in your environment:

   ```bash
   npm test
   ```

   Expect: `Test Files  3 passed (3)` / `Tests  18 passed (18)`.

---

## 3. Starting the development server (recommended for daily use)

From the project folder, run:

```bash
npm run dev
```

You will see output like:

```
  VITE v8.x.x  ready in ~500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Then **open `http://localhost:5173/` in your browser**. The dashboard loads with the
sample office building already in the 3D viewer — no further setup is needed.

Useful dev-server options:

| Command | Effect |
|---|---|
| `npm run dev` | Default port `5173`. |
| `npm run dev -- --port 3000` | Run on a different port (e.g. `http://localhost:3000/`). |
| `npm run dev -- --port 5173 --strictPort` | Fail instead of auto-picking the next free port if `5173` is busy. Without `--strictPort`, Vite silently moves to `5174`, `5175`, … — always check the `Local:` URL it prints. |
| `npm run dev -- --host` | Expose on your local network (e.g. to open the app from a tablet on the same Wi-Fi). The terminal prints a `Network:` URL such as `http://192.168.1.10:5173/`. Your firewall may ask for permission. |

To **stop** the server, press `Ctrl + C` in the terminal where it is running.

Hot-reload is enabled: editing files under `src/` refreshes the browser automatically.

---

## 4. Starting the production server (build + preview)

Use this when you want to present or share the optimized build (e.g. for the
dissertation demonstration):

```bash
npm run build     # type-checks (tsc) and bundles the app into dist/
npm run preview   # serves the dist/ build, default http://localhost:4173/
```

- `npm run preview -- --port 8080` serves on a custom port.
- The preview server does **not** hot-reload; rebuild (`npm run build`) after any code change.
- You can also serve `dist/` with any static file server, e.g. `npx serve dist`.

---

## 5. Verifying the server works

After opening the printed `Local:` URL, confirm:

1. The page title reads **"BIM Sustainability Analytics — Integrated Building Envelope Design"**.
2. The header shows the project name, a BIM status badge, and the **"Mode: Analytical / Demo"** badge.
3. The central 3D viewer shows the **sample office building** (blue walls, glass strips, grey roof) and you can drag to rotate / scroll to zoom.
4. Moving the **Outdoor air temp** slider in the left panel changes the HVAC numbers in the right panel.
5. Clicking **Arid / Tropical / Temperate** updates all climate sliders.
6. `File ▸ Import BIM model` opens the import dialog; the bundled `public/sample.ifc` file imports successfully.

If all six hold, the server and app are fully operational.

---

## 6. Available scripts

| Script | Command | Purpose |
|---|---|---|
| dev | `npm run dev` | Start the development server with hot-reload. |
| build | `npm run build` | Type-check and produce the optimized `dist/` bundle. |
| preview | `npm run preview` | Serve the production `dist/` bundle locally. |
| test | `npm test` | Run the Vitest unit suite (physics, IFC parser, CSV, exports, persistence). |
| lint | `npm run lint` | Run the linter (oxlint). |

---

## 7. Troubleshooting

**Port already in use (`Port 5173 is in use, trying another one…`)**
Vite automatically tries the next free port — just open the `Local:` URL it actually
prints. To force a specific port, use `npm run dev -- --port <n> --strictPort`, and
free the port first if needed (`lsof -i :5173` then `kill <PID>` on macOS/Linux;
`netstat -ano | findstr :5173` then Task Manager on Windows).

**`npm install` fails or hangs**
Check internet access and retry. If the npm cache is corrupt: `npm cache clean --force`
then `npm install` again. On managed machines without admin rights, install Node.js via
`nvm`/`fnm` (user-space, no sudo needed).

**Blank page or assets fail to load**
Use the exact URL the terminal prints (including the port). Hard-refresh (`Ctrl/Cmd + Shift + R`).
Check the browser console (F12) for errors and confirm no ad-blocker is interfering with localhost.

**3D viewer is black or shows an error**
The viewer needs WebGL. Enable hardware acceleration in the browser settings, update
the GPU driver, and avoid remote-desktop sessions with GPU passthrough disabled.
All other dashboard features (controls, charts, exports) work without WebGL.

**`npm run build` reports TypeScript errors**
Run `npm install` first to ensure dependencies match `package-lock.json`, then rerun
`npm run build`. The build is clean on the pinned dependency set.

**App is reachable on localhost but not from another device**
Restart with `npm run dev -- --host` and use the printed `Network:` URL. Both devices
must be on the same network, and the host firewall must allow the port.

---

## 8. First-run workflow (once the server is up)

BIM import → geometry/material extraction → climate configuration → analytical heat
balance → dashboard, charts, scenarios, sustainability → PDF/CSV/JSON export.

1. **Upload a BIM model** — File ▸ Import BIM model. Supports IFC STEP (`.ifc`,
   IFC2X3/IFC4) and normalized exchange JSON (`.json`). Try `public/sample.ifc` or
   `public/sample-model.json`. Revit `.rvt` is **not** parseable: export to IFC from
   Revit first (the app says so when you try).
2. **Inspect geometry** — orbit / zoom / pan, fit & reset camera, grid/axes/wireframe
   toggles, per-type visibility, click-to-select with properties and provenance tags.
3. **Configure climate** — Arid / Tropical / Temperate presets (editable), sliders for
   temperature, solar, cloud, wind, humidity, setpoint; or File ▸ Import climate data
   with the documented CSV format (see below). A `sample-weather.csv` download is in
   the climate dialog and `public/sample-weather.csv`.
4. **Adjust design** — WWR, U-values, SHGC, shading, infiltration, internal gains,
   orientation, natural ventilation, green roof/wall. User overrides are tagged blue;
   “Reset to model values” restores model-derived defaults.
5. **Compare scenarios** — Charts & trends tab: save/duplicate/rename/delete scenarios,
   baseline deltas (absolute + %), monthly loads from imported weather.
6. **Explore sustainability** — envelope optimization actions, passive-solar notes,
   natural-ventilation assessment, green roof/wall comparison. Integrations
   (Ladybug, Pollination, cove.tool, IES VE, EnergyPlus, Radiance) are listed with
   honest `not-configured / unavailable` statuses — none is faked as connected.
7. **Export** — PDF report (project, methodology, metrics, components, scenarios,
   warnings), CSV and JSON of the live state. **Save project** persists locally
   (localStorage + IndexedDB), not to any server.

## Calculation engine (`src/lib/calculations.ts`)

Single-zone steady-state heat balance at the indoor setpoint, SI units:

- Transmission per component: `Q = U · A · ΔT`, `ΔT = T_set − T_out` (+ = heat loss).
- Solar gain: `Q_sol = G · A_glaz · SHGC · f_shade`, with the user-supplied `G` used
  **directly** — cloud cover is informational and never applied as a hidden multiplier.
- Ventilation: `H_ve = 0.33 · ACH · V`, `Q_ve = H_ve · ΔT`, plus a disclosed ≤40%
  free-cooling credit when outdoor air can cool and natural ventilation is enabled.
- `Q_hvac = (Q_transmission + Q_ventilation) − Q_solar − Q_internal` → heating/cooling kW.
- Free-running operative temperature `T = T_out + gains / (ΣUA + H_ve)` (coarse, disclosed).
- **Daylight potential index** — explicitly *not* Daylight Autonomy (needs Radiance).
- **EUI (illustrative)** — `(heat·heat-hours + cool·cool-hours) / floor area` with
  configurable equivalent full-load hours; *not* a simulated annual result.
- Green roof/wall scale effective U-values (25% / 15% at full coverage, disclosed).

Instantaneous load (kW), energy (kWh) and annual intensity (EUI) are kept separate
throughout the UI, charts and exports.

## IFC parsing (`src/lib/ifcParser.ts`)

Browser-native minimal STEP parser: element identity/classification, storeys, material
assignments, property sets (thermal transmittance incl. typed-measure wrappers),
quantity sets (areas preferred, Length×Height fallback). Viewer boxes are
approximations from quantities and labelled as such; elements without quantities read
0 m² and are excluded from totals with a warning. Provenance of every value:
`extracted / derived / user / assumption / unknown`.

## Climate CSV format

```csv
timestamp,outdoorTempC,solarWm2,relHumidityPct,windMs[,cloudPct]
2026-07-01T12:00,26,830,42,2.8,20
```

Header names are case/format-insensitive; ranges are validated; bad rows are skipped
with warnings; a preview is shown before applying. EPW files are not parsed. A single
row sets one snapshot only — no annual results are derived from it.

## Project structure

```
src/
  App.tsx                 shell, state, header/menus, sidebar, analytics, dialogs
  components/Viewer3D.tsx Three.js viewer (orbit/select/toggles/fit)
  components/Charts.tsx   recharts wrappers (all driven by live state)
  lib/types.ts            domain model + provenance
  lib/calculations.ts     documented physics engine (+ .test.ts)
  lib/ifcParser.ts        IFC-SPF parser (+ .test.ts)
  lib/climateCsv.ts       CSV import/validation
  lib/sampleBuilding.ts   sample office + demo tower + presets
  lib/exports.ts          CSV / JSON / PDF report
  lib/persistence.ts      localStorage + IndexedDB
public/                   sample.ifc, sample-model.json, sample-weather.csv
DOCTYPE.html, 261002_*.pdf  original prototype + interface reference (kept)
```

## Limitations (stated in-app, not just here)

- Simplified single-zone steady-state model: no thermal mass, solar geometry, HVAC
  curves, CFD airflow, or Radiance daylight — unsuitable for compliance or sizing.
- IFC geometry shown as quantity-derived boxes, not original B-rep.
- No live Ladybug/Pollination/cove.tool/IES VE/EnergyPlus connections.
- Daylight = potential index; EUI = illustrative annualization; both labelled.
- Persistence is browser-local only.
