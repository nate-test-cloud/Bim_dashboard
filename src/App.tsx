import { useEffect, useMemo, useRef, useState } from 'react';
import Viewer3D from './components/Viewer3D';
import { GroupedBar, SimpleBar, SolarSweepChart, TempSweepChart } from './components/Charts';
import {
  heatBalance,
  scaledGlazingArea,
  summarizeEnvelope,
  sweepOutdoorTemp,
  sweepSolar,
  type HeatBalanceInputs,
} from './lib/calculations';
import { parseClimateCsv, SAMPLE_CLIMATE_CSV, type ClimateTable } from './lib/climateCsv';
import { exportPdf, toCsv, toJson, downloadText, type ExportBundle } from './lib/exports';
import { parseIfcText, validateIfcFile } from './lib/ifcParser';
import { loadProject, saveProject, idbSet } from './lib/persistence';
import { CLIMATE_PRESETS, demoTower, sampleBuilding } from './lib/sampleBuilding';
import {
  fetchSiteClimateData,
  generateMonthlySeriesForSite,
  POPULAR_SITES,
  searchLocations,
  type SiteClimateData,
  type SiteLocation,
} from './lib/locationClimate';
import type {
  BuildingModel,
  DesignInputs,
  EnvInputs,
  IntegrationStatus,
  ProvValue,
  Scenario,
} from './lib/types';
import { PROVENANCE_LABEL } from './lib/types';

const pv = (value: number, provenance: ProvValue['provenance'] = 'assumption'): ProvValue => ({
  value,
  provenance,
});
const uuid = () => Math.random().toString(36).slice(2, 9);

const INTEGRATIONS: IntegrationStatus[] = [
  { name: 'Ladybug Tools', status: 'not-configured', detail: 'Not connected — requires Rhino/Grasshopper + Ladybug installation. Analytical demo mode is used instead.' },
  { name: 'Pollination', status: 'not-configured', detail: 'Not connected — requires Pollination cloud account and API key.' },
  { name: 'Cove.tool', status: 'not-configured', detail: 'Not connected — requires cove.tool project and API access.' },
  { name: 'IES VE', status: 'not-configured', detail: 'Not connected — requires IES VE licence and file-based exchange.' },
  { name: 'EnergyPlus / OpenStudio', status: 'unavailable', detail: 'No local engine detected — structure reserved for future server-side integration.' },
  { name: 'Radiance daylight', status: 'unavailable', detail: 'No daylight engine detected — daylight shown as potential index only.' },
];

function avgU(model: BuildingModel, cat: string, fallback: number): ProvValue {
  const els = model.elements.filter((e) => e.category === cat && e.uValueWm2K && e.uValueWm2K > 0);
  if (!els.length) return pv(fallback, 'assumption');
  const ext = els.filter((e) => e.uProvenance === 'extracted');
  const use = ext.length ? ext : els;
  const wSum = use.reduce((a, e) => a + e.areaM2, 0);
  const v = use.reduce((a, e) => a + (e.uValueWm2K ?? 0) * e.areaM2, 0) / Math.max(wSum, 1e-6);
  return { value: +v.toFixed(2), provenance: ext.length ? 'extracted' : 'assumption' };
}

function designFromModel(model: BuildingModel): DesignInputs {
  const s = summarizeEnvelope(model);
  return {
    wallU: avgU(model, 'wall', 0.35),
    roofU: avgU(model, 'roof', 0.25),
    glazingU: avgU(model, 'window', 1.4),
    shgc: pv(0.35, 'assumption'),
    shadingFactor: pv(1.0, 'assumption'),
    wwr: { value: +s.wwr.toFixed(2) || 0.4, provenance: s.wallArea + s.windowArea > 0 ? 'derived' : 'assumption' },
    orientationDeg: 0,
    infiltrationACH: 0.5,
    internalGainsWm2: 8,
    ventilationOpenableFraction: 0.2,
    greenRoofFraction: 0,
    greenWallFraction: 0,
    naturalVentilationOn: false,
    euiTargetKwhM2Yr: 100,
    carbonFactorKgPerKwh: 0.4,
    equivHeatingHours: 800,
    equivCoolingHours: 1200,
  };
}

const DEFAULT_ENV: EnvInputs = {
  outdoorTempC: 28,
  solarIrradianceWm2: 800,
  cloudCoverPct: 20,
  windSpeedMs: 1.5,
  relHumidityPct: 45,
  indoorSetpointC: 22,
  analysisDate: '2026-06-01',
};

function ProvTag({ v }: { v: ProvValue }) {
  const code = v.provenance === 'extracted' ? 'IFC' : v.provenance === 'derived' ? 'GEO' : 'STD';
  return (
    <span className={`prov ${v.provenance}`} title={PROVENANCE_LABEL[v.provenance]}>
      {code}
    </span>
  );
}

function SliderRow(props: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  tip?: string; onChange: (v: number) => void; prov?: ProvValue;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [textVal, setTextVal] = useState(String(props.value));
  const barRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Sync text value when external value changes
  useEffect(() => {
    if (!isEditing) setTextVal(String(props.value));
  }, [props.value, isEditing]);

  const pct = Math.max(0, Math.min(100, ((props.value - props.min) / (props.max - props.min)) * 100));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditing) return;
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const updateFromPointer = (clientX: number) => {
      if (!barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = props.min + ratio * (props.max - props.min);
      const stepped = Math.round(raw / props.step) * props.step;
      const precision = props.step < 0.1 ? 2 : props.step < 1 ? 1 : 0;
      props.onChange(Number(stepped.toFixed(precision)));
    };

    updateFromPointer(e.clientX);

    const handlePointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      updateFromPointer(ev.clientX);
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleCommitText = () => {
    setIsEditing(false);
    const n = parseFloat(textVal);
    if (!isNaN(n)) {
      const clamped = Math.max(props.min, Math.min(props.max, n));
      const precision = props.step < 0.1 ? 2 : props.step < 1 ? 1 : 0;
      props.onChange(Number(clamped.toFixed(precision)));
    }
  };

  return (
    <div
      ref={barRef}
      className={`blender-scrubber ${isEditing ? 'editing' : ''}`}
      onPointerDown={handlePointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
        setTextVal(String(props.value));
      }}
      title={props.tip ? `${props.tip} (Drag horizontally to scrub, double-click to type)` : 'Drag horizontally to scrub, double-click to type'}
      role="slider"
      aria-label={props.label}
      aria-valuenow={props.value}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      tabIndex={0}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          const precision = props.step < 0.1 ? 2 : props.step < 1 ? 1 : 0;
          props.onChange(Number(Math.min(props.max, props.value + props.step).toFixed(precision)));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          const precision = props.step < 0.1 ? 2 : props.step < 1 ? 1 : 0;
          props.onChange(Number(Math.max(props.min, props.value - props.step).toFixed(precision)));
        } else if (e.key === 'Enter') {
          setIsEditing(true);
        }
      }}
    >
      {/* Background scrub fill progress */}
      <div className="scrubber-bar-fill" style={{ width: `${pct}%` }} />

      {/* Scrubber Label & Provenance */}
      <div className="scrubber-label-group">
        <span className="scrubber-label">{props.label}</span>
        {props.prov && <ProvTag v={props.prov} />}
      </div>

      {/* Scrubber Value Display or Input */}
      {isEditing ? (
        <input
          type="number"
          autoFocus
          className="scrubber-inline-input"
          value={textVal}
          step={props.step}
          onChange={(e) => setTextVal(e.target.value)}
          onBlur={handleCommitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommitText();
            if (e.key === 'Escape') setIsEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="scrubber-value-group">
          <span className="scrubber-num">{props.value}</span>
          {props.unit && <span className="scrubber-unit">{props.unit}</span>}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [projectName, setProjectName] = useState('Envelope Study');
  const [model, setModel] = useState<BuildingModel>(() => sampleBuilding());
  const [modelStatus, setModelStatus] = useState('Sample building loaded');
  const [env, setEnv] = useState<EnvInputs>(DEFAULT_ENV);
  const [design, setDesign] = useState<DesignInputs>(() => designFromModel(sampleBuilding()));
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [climate, setClimate] = useState<ClimateTable | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invFilter, setInvFilter] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);

  // site location and live climate state
  const [siteLocation, setSiteLocation] = useState<SiteLocation | null>(null);
  const [siteClimate, setSiteClimate] = useState<SiteClimateData | null>(null);
  const [locSearchQuery, setLocSearchQuery] = useState('');
  const [locSuggestions, setLocSuggestions] = useState<SiteLocation[]>([]);
  const [isSearchingLoc, setIsSearchingLoc] = useState(false);
  const [isLoadingClimate, setIsLoadingClimate] = useState(false);
  const [showLocDropdown, setShowLocDropdown] = useState(false);
  const [activeClimateMode, setActiveClimateMode] = useState<'current' | 'daylight' | 'summer' | 'winter'>('daylight');
  const [activeArchetype, setActiveArchetype] = useState<'arid' | 'tropical' | 'temperate' | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<any>(null);

  // view toggles
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [visibleTypes, setVisibleTypes] = useState<Record<string, boolean>>({
    wall: true, window: true, door: true, roof: true, floor: true, structure: true, other: true, tower: true,
  });
  // dialogs
  const [dlg, setDlg] = useState<null | 'bim' | 'climate' | 'help' | 'settings' | 'plugins'>(null);
  const [tab, setTab] = useState<'charts' | 'scenarios' | 'sustain' | 'data'>('charts');
  const [inspectorTab, setInspectorTab] = useState<'envelope' | 'climate' | 'specs' | 'model'>('envelope');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // BIM import state
  const [importLog, setImportLog] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importBusy, setImportBusy] = useState(false);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const climateInputRef = useRef<HTMLInputElement>(null);

  // restore persisted project once
  useEffect(() => {
    const saved = loadProject();
    if (saved) {
      try {
        setProjectName(saved.projectName as string);
        setEnv(saved.env as EnvInputs);
        setDesign(saved.design as DesignInputs);
        setScenarios(saved.scenarios as Scenario[]);
        if (saved.modelMeta) {
          setModel(saved.modelMeta as BuildingModel);
          setModelStatus('Restored saved project model (local)');
        }
        setNotice({ kind: 'ok', text: `Restored locally saved project from ${saved.savedAt}.` });
      } catch {
        /* ignore corrupt save */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => summarizeEnvelope(model), [model]);
  const scaled = useMemo(
    () => scaledGlazingArea(summary, design.wwr.value),
    [summary, design.wwr.value],
  );

  const heatInputs: HeatBalanceInputs = useMemo(
    () => ({
      areas: {
        wallM2: scaled.opaqueWallM2,
        roofM2: summary.roofArea,
        glazingM2: scaled.glazingM2,
        doorM2: summary.doorArea,
      },
      uValues: {
        wallU: design.wallU.value * (1 - 0.15 * design.greenWallFraction),
        roofU: design.roofU.value * (1 - 0.25 * design.greenRoofFraction),
        glazingU: design.glazingU.value,
        doorU: 2.2,
      },
      env,
      design,
      volumeM3: model.volumeM3,
      floorAreaM2: model.floorAreaM2,
    }),
    [scaled, summary, design, env, model],
  );
  const results = useMemo(() => heatBalance(heatInputs), [heatInputs]);

  const resultsFor = (s: Scenario) => {
    const sum = summarizeEnvelope(model);
    const sc = scaledGlazingArea(sum, s.design.wwr.value);
    return heatBalance({
      areas: { wallM2: sc.opaqueWallM2, roofM2: sum.roofArea, glazingM2: sc.glazingM2, doorM2: sum.doorArea },
      uValues: {
        wallU: s.design.wallU.value * (1 - 0.15 * s.design.greenWallFraction),
        roofU: s.design.roofU.value * (1 - 0.25 * s.design.greenRoofFraction),
        glazingU: s.design.glazingU.value,
        doorU: 2.2,
      },
      env: s.env,
      design: s.design,
      volumeM3: model.volumeM3,
      floorAreaM2: model.floorAreaM2,
    });
  };

  const baseline: Scenario | null = useMemo(() => {
    if (baselineId) return scenarios.find((s) => s.id === baselineId) ?? null;
    return scenarios.length ? scenarios[0] : null;
  }, [scenarios, baselineId]);
  const baselineResults = baseline ? resultsFor(baseline) : null;

  const tempSweep = useMemo(() => sweepOutdoorTemp(heatInputs, -5, 45, 26), [heatInputs]);
  const solarSweep = useMemo(() => sweepSolar(heatInputs, 0, 1200, 25), [heatInputs]);

  const monthlyLoads = useMemo(() => {
    if (climate && climate.monthlyAverages.length >= 2) {
      return climate.monthlyAverages.map((m) => {
        const r = heatBalance({
          ...heatInputs,
          env: { ...heatInputs.env, outdoorTempC: m.tAvgC, solarIrradianceWm2: m.solarWm2 },
        });
        return {
          name: m.month.slice(0, 7),
          heating_kW: +(r.heatingLoadW / 1000).toFixed(2),
          cooling_kW: +(r.coolingLoadW / 1000).toFixed(2),
        };
      });
    }
    if (siteClimate) {
      const series = generateMonthlySeriesForSite(
        siteClimate.location,
        siteClimate.current.outdoorTempC,
        siteClimate.daylightPeak.solarIrradianceWm2,
      );
      return series.map((m) => {
        const r = heatBalance({
          ...heatInputs,
          env: { ...heatInputs.env, outdoorTempC: m.tAvgC, solarIrradianceWm2: m.solarWm2 },
        });
        return {
          name: m.month.slice(5),
          heating_kW: +(r.heatingLoadW / 1000).toFixed(2),
          cooling_kW: +(r.coolingLoadW / 1000).toFixed(2),
        };
      });
    }
    return null;
  }, [climate, siteClimate, heatInputs]);

  const presetCompare = useMemo(
    () => {
      if (siteClimate) {
        const siteScenarios = [
          { name: `${siteClimate.location.name} (Live)`, env: siteClimate.current },
          { name: `${siteClimate.location.name} (Daylight peak)`, env: siteClimate.daylightPeak },
          { name: `${siteClimate.location.name} (Summer peak)`, env: siteClimate.summerDesign },
          { name: `${siteClimate.location.name} (Winter peak)`, env: siteClimate.winterDesign },
          { name: 'Arid ref', env: CLIMATE_PRESETS.arid.env },
          { name: 'Temperate ref', env: CLIMATE_PRESETS.temperate.env },
        ];
        return siteScenarios.map((s) => {
          const r = heatBalance({
            ...heatInputs,
            env: { ...heatInputs.env, ...s.env },
          });
          return { name: s.name, heating_kW: +(r.heatingLoadW / 1000).toFixed(2), cooling_kW: +(r.coolingLoadW / 1000).toFixed(2) };
        });
      }
      return (Object.keys(CLIMATE_PRESETS) as (keyof typeof CLIMATE_PRESETS)[]).map((k) => {
        const pr = CLIMATE_PRESETS[k];
        const r = heatBalance({
          ...heatInputs,
          env: { ...heatInputs.env, outdoorTempC: pr.env.outdoorTempC, solarIrradianceWm2: pr.env.solarIrradianceWm2, cloudCoverPct: pr.env.cloudCoverPct, windSpeedMs: pr.env.windSpeedMs, relHumidityPct: pr.env.relHumidityPct },
        });
        return { name: k, heating_kW: +(r.heatingLoadW / 1000).toFixed(2), cooling_kW: +(r.coolingLoadW / 1000).toFixed(2) };
      });
    },
    [heatInputs, siteClimate],
  );

  const scenarioRows = useMemo(
    () =>
      scenarios.map((s) => {
        const r = resultsFor(s);
        return {
          name: s.name,
          heating_kW: +(r.heatingLoadW / 1000).toFixed(2),
          cooling_kW: +(r.coolingLoadW / 1000).toFixed(2),
          solar_kW: +(r.solarGainW / 1000).toFixed(2),
          eui: r.euiIllustrative,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenarios, model, heatInputs],
  );

  // ---------- actions ----------
  const set = <K extends keyof EnvInputs>(k: K, v: EnvInputs[K]) =>
    setEnv((e) => ({ ...e, [k]: v }));
  const setD = (k: keyof DesignInputs, value: number, markUser = true) =>
    setDesign((d) => {
      const cur = d[k];
      if (typeof cur === 'object' && cur !== null && 'value' in cur) {
        return {
          ...d,
          [k]: {
            ...(cur as ProvValue),
            value,
            provenance: markUser ? 'user' : (cur as ProvValue).provenance,
          },
        };
      }
      return { ...d, [k]: value };
    });

  const handleSearchQueryChange = (val: string) => {
    setLocSearchQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!val.trim()) {
      setLocSuggestions([]);
      setShowLocDropdown(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setIsSearchingLoc(true);
      if (searchAbortRef.current) searchAbortRef.current.abort();
      searchAbortRef.current = new AbortController();
      try {
        const results = await searchLocations(val, searchAbortRef.current.signal);
        setLocSuggestions(results);
        setShowLocDropdown(true);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error(err);
        }
      } finally {
        setIsSearchingLoc(false);
      }
    }, 300);
  };

  const executeSearchNow = async () => {
    if (!locSearchQuery.trim()) {
      setLocSuggestions(POPULAR_SITES.slice(0, 5));
      setShowLocDropdown(true);
      return;
    }
    setIsSearchingLoc(true);
    if (searchAbortRef.current) searchAbortRef.current.abort();
    searchAbortRef.current = new AbortController();
    try {
      const results = await searchLocations(locSearchQuery, searchAbortRef.current.signal);
      setLocSuggestions(results);
      setShowLocDropdown(true);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error(err);
      }
    } finally {
      setIsSearchingLoc(false);
    }
  };

  const handleApplyArchetype = (key: 'arid' | 'tropical' | 'temperate') => {
    setActiveArchetype(key);
    setSiteLocation(null);
    setSiteClimate(null);
    setLocSearchQuery('');
    const p = CLIMATE_PRESETS[key];
    setEnv((e) => ({
      ...e,
      outdoorTempC: p.env.outdoorTempC,
      solarIrradianceWm2: p.env.solarIrradianceWm2,
      cloudCoverPct: p.env.cloudCoverPct,
      windSpeedMs: p.env.windSpeedMs,
      relHumidityPct: p.env.relHumidityPct,
    }));
    setNotice({ kind: 'ok', text: `Applied ${p.label} preset. Parameters are fully editable below.` });
  };

  const handleSelectLocation = async (loc: SiteLocation) => {
    setActiveArchetype(null);
    setSiteLocation(loc);
    setShowLocDropdown(false);
    setLocSearchQuery(`${loc.name}${loc.country ? ', ' + loc.country : ''}`);
    setIsLoadingClimate(true);
    try {
      const data = await fetchSiteClimateData(loc);
      setSiteClimate(data);
      const target = data.isDay && data.current.solarIrradianceWm2 > 30 ? data.current : data.daylightPeak;
      const mode = data.isDay && data.current.solarIrradianceWm2 > 30 ? 'current' : 'daylight';
      setActiveClimateMode(mode);
      setEnv((e) => ({
        ...e,
        outdoorTempC: target.outdoorTempC,
        solarIrradianceWm2: target.solarIrradianceWm2,
        cloudCoverPct: target.cloudCoverPct,
        windSpeedMs: target.windSpeedMs,
        relHumidityPct: target.relHumidityPct,
        analysisDate: new Date().toISOString().slice(0, 10),
      }));
      setNotice({
        kind: 'ok',
        text: `Site set to ${loc.name}, ${loc.country}. Live climate applied (${data.source === 'open-meteo-live' ? 'Open-Meteo API' : 'Regional model'}).`,
      });
    } catch {
      setNotice({ kind: 'err', text: `Failed to load climatic data for ${loc.name}.` });
    } finally {
      setIsLoadingClimate(false);
    }
  };

  const handleApplyClimateMode = (mode: 'current' | 'daylight' | 'summer' | 'winter') => {
    if (!siteClimate) return;
    setActiveClimateMode(mode);
    const cond =
      mode === 'current'
        ? siteClimate.current
        : mode === 'daylight'
        ? siteClimate.daylightPeak
        : mode === 'summer'
        ? siteClimate.summerDesign
        : siteClimate.winterDesign;

    setEnv((e) => ({
      ...e,
      outdoorTempC: cond.outdoorTempC,
      solarIrradianceWm2: cond.solarIrradianceWm2,
      cloudCoverPct: cond.cloudCoverPct,
      windSpeedMs: cond.windSpeedMs,
      relHumidityPct: cond.relHumidityPct,
    }));
    const label =
      mode === 'current'
        ? 'Live snapshot'
        : mode === 'daylight'
        ? 'Daylight peak solar'
        : mode === 'summer'
        ? 'Summer design condition'
        : 'Winter design condition';
    setNotice({ kind: 'ok', text: `Applied ${label} for ${siteClimate.location.name}. Values remain editable.` });
  };

  const refreshSiteClimate = async () => {
    if (!siteLocation) return;
    setIsLoadingClimate(true);
    try {
      const data = await fetchSiteClimateData(siteLocation);
      setSiteClimate(data);
      handleApplyClimateMode(activeClimateMode);
      setNotice({ kind: 'ok', text: `Climatic data refreshed for ${siteLocation.name}.` });
    } catch {
      setNotice({ kind: 'err', text: 'Failed to refresh climatic data.' });
    } finally {
      setIsLoadingClimate(false);
    }
  };

  const clearSiteLocation = () => {
    setSiteLocation(null);
    setSiteClimate(null);
    setLocSearchQuery('');
    setShowLocDropdown(false);
    setNotice({ kind: 'ok', text: 'Site location cleared. Environmental parameters can now be manually adjusted.' });
  };

  const resetToModel = () => {
    setDesign((d) => ({ ...designFromModel(model), euiTargetKwhM2Yr: d.euiTargetKwhM2Yr, carbonFactorKgPerKwh: d.carbonFactorKgPerKwh, equivHeatingHours: d.equivHeatingHours, equivCoolingHours: d.equivCoolingHours }));
    setNotice({ kind: 'ok', text: 'Design values reset to model-derived defaults.' });
  };

  const loadSample = () => {
    const m = sampleBuilding();
    setModel(m);
    setDesign((d) => ({ ...designFromModel(m), euiTargetKwhM2Yr: d.euiTargetKwhM2Yr, carbonFactorKgPerKwh: d.carbonFactorKgPerKwh, equivHeatingHours: d.equivHeatingHours, equivCoolingHours: d.equivCoolingHours }));
    setSelectedId(null);
    setModelStatus('Sample building loaded');
    setNotice({ kind: 'ok', text: 'Sample office building loaded (walls, windows, roof, floor identifiable).' });
  };

  const loadDemoTower = () => {
    setModel(demoTower());
    setSelectedId(null);
    setModelStatus('Demo tower (abstract)');
    setNotice({ kind: 'warn', text: 'Abstract demo tower shown — preserved from prototype; not suitable for envelope analysis.' });
  };

  const handleBimFile = async (file: File) => {
    setImportLog([]);
    setImportProgress(0);
    const log = (s: string) => setImportLog((l) => [...l, s]);
    if (file.name.toLowerCase().endsWith('.json')) {
      setImportBusy(true);
      try {
        const text = await file.text();
        const j = JSON.parse(text);
        if (!Array.isArray(j.elements)) throw new Error('JSON model must contain an "elements" array.');
        const m: BuildingModel = {
          name: j.name ?? file.name,
          source: 'json',
          sourceFileName: file.name,
          schema: 'normalized-json-v1',
          storeys: j.storeys ?? [],
          spaces: j.spaces ?? 0,
          elements: j.elements,
          floorAreaM2: j.floorAreaM2 ?? 200,
          floorAreaProvenance: j.floorAreaM2 ? 'extracted' : 'assumption',
          volumeM3: j.volumeM3 ?? 600,
          volumeProvenance: j.volumeM3 ? 'extracted' : 'assumption',
          warnings: ['Imported from normalized JSON exchange (not raw BIM geometry).'],
          geometryFidelity: 'approximate',
        };
        setModel(m);
        setDesign((d) => ({ ...designFromModel(m), euiTargetKwhM2Yr: d.euiTargetKwhM2Yr, carbonFactorKgPerKwh: d.carbonFactorKgPerKwh, equivHeatingHours: d.equivHeatingHours, equivCoolingHours: d.equivCoolingHours }));
        setModelStatus(`JSON model loaded (${m.elements.length} elements)`);
        log(`Loaded ${m.elements.length} elements from normalized JSON.`);
        setNotice({ kind: 'ok', text: `Normalized JSON model "${m.name}" loaded.` });
        try { await idbSet('last-model', file); } catch { /* non-fatal */ }
      } catch (e) {
        log(`ERROR: ${e instanceof Error ? e.message : e}`);
        setNotice({ kind: 'err', text: `JSON import failed: ${e instanceof Error ? e.message : e}` });
      } finally {
        setImportBusy(false);
      }
      return;
    }
    const err = validateIfcFile(file);
    if (err) {
      log(`ERROR: ${err}`);
      setNotice({ kind: 'err', text: err });
      return;
    }
    setImportBusy(true);
    cancelRef.current = false;
    try {
      log(`Reading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
      if (file.size > 150 * 1024 * 1024)
        log('Note: large file — parsing runs locally in your browser and may take a while. Progress is shown below.');
      const text = await file.text();
      if (cancelRef.current) { log('Cancelled by user.'); return; }
      // Show the ACTUAL imported geometry: parse then replace the viewer model.
      const parsed = await parseIfcText(text, file.name, (p) => {
        setImportProgress(Math.round(p.fraction * 100));
        log(`${p.phase}…`);
      });
      if (cancelRef.current) { log('Cancelled by user.'); return; }
      for (const w of parsed.warnings) log(`WARN: ${w}`);
      setModel(parsed);
      setDesign((d) => ({ ...designFromModel(parsed), euiTargetKwhM2Yr: d.euiTargetKwhM2Yr, carbonFactorKgPerKwh: d.carbonFactorKgPerKwh, equivHeatingHours: d.equivHeatingHours, equivCoolingHours: d.equivCoolingHours }));
      setSelectedId(null);
      setModelStatus(`IFC loaded (${parsed.elements.length} elements)`);
      setNotice({ kind: 'ok', text: `IFC model "${parsed.name}" imported — viewer now shows the imported elements.` });
      setImportProgress(100);
      try { await idbSet('last-model', file); } catch { /* non-fatal */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`ERROR: ${msg}`);
      setNotice({ kind: 'err', text: `IFC import failed: ${msg}` });
    } finally {
      setImportBusy(false);
    }
  };

  const handleClimateFile = async (file: File) => {
    try {
      const text = await file.text();
      const table = parseClimateCsv(text);
      setClimate(table);
      const first = table.rows[0];
      setEnv((e) => ({
        ...e,
        outdoorTempC: first.outdoorTempC,
        solarIrradianceWm2: first.solarWm2,
        relHumidityPct: first.relHumidityPct,
        windSpeedMs: first.windMs,
        cloudCoverPct: first.cloudPct ?? e.cloudCoverPct,
      }));
      setNotice({
        kind: table.rows.length > 1 ? 'ok' : 'warn',
        text: `Climate CSV applied: ${table.rows.length} valid rows. First row sets current conditions; monthly chart uses series means.`,
      });
      setDlg(null);
    } catch (e) {
      setNotice({ kind: 'err', text: `Climate import failed: ${e instanceof Error ? e.message : e}` });
    }
  };

  const saveScenario = () => {
    const s: Scenario = {
      id: uuid(),
      name: `Scenario ${scenarios.length + 1}`,
      env: { ...env },
      design: JSON.parse(JSON.stringify(design)) as DesignInputs,
      createdAt: new Date().toISOString(),
    };
    setScenarios((sc) => [...sc, s]);
    if (!baselineId) setBaselineId(s.id);
    setNotice({ kind: 'ok', text: `Saved ${s.name}. Compare it under the Scenarios tab.` });
  };

  const bundle = (): ExportBundle => ({
    projectName,
    model,
    env,
    design,
    results,
    scenarios,
    scenarioResults: scenarioRows.map((r) => ({
      name: r.name,
      heatingKW: r.heating_kW,
      coolingKW: r.cooling_kW,
      eui: r.eui,
      solarKW: r.solar_kW,
    })),
  });

  const persist = () => {
    saveProject({ projectName, env, design, scenarios, modelMeta: model, euiTarget: design.euiTargetKwhM2Yr });
    setNotice({ kind: 'ok', text: 'Project saved locally (browser localStorage; model file blob in IndexedDB). Not a server save.' });
  };

  // ---------- small render helpers (stable component types live at module level) ----------
  const Prov = ProvTag;
  const Slider = SliderRow;

  const selected = model.elements.find((e) => e.id === selectedId) ?? null;
  const filteredInv = useMemo(() => {
    const f = invFilter.trim().toLowerCase();
    if (!f) return model.elements;
    return model.elements.filter((e) =>
      `${e.name} ${e.category} ${e.ifcType ?? ''} ${e.storey ?? ''}`.toLowerCase().includes(f),
    );
  }, [model, invFilter]);
  const coolKW = results.coolingLoadW / 1000;
  const heatKW = results.heatingLoadW / 1000;
  const eui = results.euiIllustrative;
  const [collapsedStoreys, setCollapsedStoreys] = useState<Record<string, boolean>>({});
  const toggleStorey = (st: string) => setCollapsedStoreys((prev) => ({ ...prev, [st]: !prev[st] }));

  const groupedElements = useMemo(() => {
    const map = new Map<string, typeof filteredInv>();
    for (const el of filteredInv) {
      const s = el.storey || 'Storey: Level 01';
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(el);
    }
    return Array.from(map.entries());
  }, [filteredInv]);
  const vsBase =
    baselineResults != null
      ? {
          heat: heatKW - baselineResults.heatingLoadW / 1000,
          cool: coolKW - baselineResults.coolingLoadW / 1000,
          eui: eui != null && baselineResults.euiIllustrative != null ? eui - baselineResults.euiIllustrative : null,
        }
      : null;

  const pct = (delta: number, base: number) =>
    Math.abs(base) < 1e-9 ? '—' : `${delta >= 0 ? '+' : ''}${((delta / Math.abs(base)) * 100).toFixed(1)}%`;

  return (
    <div className="app">
      {/* ================= Swiss Architectural CAD Header ================= */}
      <header className="topbar">
        <div className="brand">
          <img
            src="/logo.png"
            alt="BIM Sustainability Analytics"
            className="brand-logo"
            title="BIM Sustainability Analytics"
          />
          <span className="brand-sep">/</span>
          <span className="brand-model">{model.name}</span>
        </div>

        {/* Clean Workstation Model Switcher */}
        <div className="topbar-model-picker">
          <button
            className={`topbar-model-btn ${model.name === 'Sample Office (Parametric)' ? 'active' : ''}`}
            onClick={loadSample}
            title="Load Parametric Sample Building"
          >
            Sample Office
          </button>
          <button
            className={`topbar-model-btn ${model.name.includes('Tower') ? 'active' : ''}`}
            onClick={loadDemoTower}
            title="Load Twisting Glass Tower"
          >
            Tower Model
          </button>
        </div>

        {siteLocation && (
          <div className="topbar-meta">
            <span className="topbar-loc">📍 {siteLocation.name}, {siteLocation.country}</span>
            <span className="mono topbar-cond">{env.outdoorTempC}°C · {env.solarIrradianceWm2} W/m²</span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Action Controls */}
        <div className="topbar-actions">
          <button className="btn primary" onClick={() => { setImportLog([]); setImportProgress(0); setDlg('bim'); }} title="Import IFC or JSON BIM model">
            + Import IFC
          </button>
          <button className="btn" onClick={() => { try { exportPdf(bundle()); } catch (e) { setNotice({ kind: 'err', text: `PDF export failed: ${e instanceof Error ? e.message : e}` }); } }} title="Export Architectural Report">
            Export PDF
          </button>
          <button className="btn" onClick={() => downloadText('analysis.csv', toCsv(bundle()), 'text/csv')} title="Export Numerical Data">
            CSV
          </button>
          <button className="btn" onClick={() => setDlg('settings')} title="Settings & Preferences">
            ⚙
          </button>
        </div>
      </header>

      {notice && (
        <div style={{ padding: '6px 14px 0' }}>
          <div className={notice.kind === 'err' ? 'errbox' : notice.kind === 'warn' ? 'warnbox' : 'okbox'}>
            {notice.text} <button className="btn" style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => setNotice(null)}>dismiss</button>
          </div>
        </div>
      )}

      {/* ================= CAD & STUDIO WORKSPACE ================= */}
      <div className="cad-workspace">
        {/* Full-Bleed 3D Viewport Hero */}
        <div className="cad-stage">
          <Viewer3D
            model={model}
            wireframe={wireframe}
            showGrid={showGrid}
            showAxes={showAxes}
            visibleTypes={visibleTypes}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            autoRotate={autoRotate}
            onToggleAutoRotate={() => setAutoRotate((v) => !v)}
            onToggleWireframe={() => setWireframe((v) => !v)}
            onToggleGrid={() => setShowGrid((v) => !v)}
            onToggleAxes={() => setShowAxes((v) => !v)}
          />

          {/* Blender-Style Left Viewport 'T' Shelf Toolbar */}
          <div className="cad-left-shelf">
            <button
              className={`shelf-tool-btn ${!autoRotate ? 'active' : ''}`}
              title="Select / Pick Element (B)"
              onClick={() => {}}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7 18 3-7 7-3L3 3z"/></svg>
            </button>
            <button
              className={`shelf-tool-btn ${autoRotate ? 'active' : ''}`}
              title="Auto-Orbit Turntable (Space)"
              onClick={() => setAutoRotate((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            </button>
            <button
              className={`shelf-tool-btn ${wireframe ? 'active' : ''}`}
              title="Toggle Wireframe Overlay (Z)"
              onClick={() => setWireframe((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            </button>
            <button
              className={`shelf-tool-btn ${showGrid ? 'active' : ''}`}
              title="Toggle Spatial Ground Grid (G)"
              onClick={() => setShowGrid((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
            </button>
            <button
              className={`shelf-tool-btn ${showAxes ? 'active' : ''}`}
              title="Toggle World XYZ Axes"
              onClick={() => setShowAxes((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="12" x2="12" y2="2"/><line x1="12" y1="12" x2="22" y2="12"/><line x1="12" y1="12" x2="5" y2="19"/></svg>
            </button>
          </div>

          {/* Floating High-Density Viewport Telemetry HUD */}
          <div className="cad-telemetry-hud">
            <div className="hud-metric">
              <span className="hud-label">OPERATIVE</span>
              <span className="hud-val">{results.operativeTempMaintainedC.toFixed(1)}°C</span>
              <span className="hud-sub">{results.comfortStatus}</span>
            </div>
            <div className="hud-sep" />
            <div className="hud-metric">
              <span className="hud-label">DEMAND ({results.activeMode.toUpperCase()})</span>
              <span className="hud-val">{Math.max(heatKW, coolKW).toFixed(1)} kW</span>
              <span className="hud-sub">h {heatKW.toFixed(1)} · c {coolKW.toFixed(1)}</span>
            </div>
            <div className="hud-sep" />
            <div className="hud-metric">
              <span className="hud-label">SOLAR GAIN</span>
              <span className="hud-val">{(results.solarGainW / 1000).toFixed(1)} kW</span>
              <span className="hud-sub">transmitted</span>
            </div>
            <div className="hud-sep" />
            <div className="hud-metric">
              <span className="hud-label">ANNUAL EUI</span>
              <span className="hud-val">{eui?.toFixed(0) ?? '—'} <span className="hud-unit">kWh/m²</span></span>
              <span className="hud-sub">target: {design.euiTargetKwhM2Yr}</span>
            </div>
          </div>

          {/* Collapsible Bottom Drawer for Analytical Charts */}
          <div className={`cad-bottom-drawer ${drawerOpen ? 'open' : 'closed'}`}>
            <div
              className="drawer-handle"
              onClick={() => setDrawerOpen((o) => !o)}
              title={drawerOpen ? 'Click to collapse analytics drawer' : 'Click to expand analytics drawer'}
            >
              <div className="drawer-handle-left">
                <span className="drawer-icon">{drawerOpen ? '▼' : '▲'}</span>
                <span className="drawer-title">ANALYTICS &amp; PARAMETRIC SWEEPS</span>
                <span className="drawer-badge">{tab.toUpperCase()}</span>
              </div>
              <div className="drawer-handle-center">
                <span>● {modelStatus} · ISO 13790 Analytical Model</span>
              </div>
              <div className="drawer-handle-right">
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  Entities: {model.elements.length} · {model.floorAreaM2} m² · {model.volumeM3} m³
                </span>
                <span className="drawer-hint" style={{ marginLeft: 12 }}>{drawerOpen ? 'Collapse ▾' : 'Expand ▴'}</span>
              </div>
            </div>

            {drawerOpen && (
              <div className="drawer-body">
                <div className="drawer-tabs">
                  {(['charts', 'scenarios', 'sustain', 'data'] as const).map((t) => (
                    <button
                      key={t}
                      className={`drawer-tab-btn ${tab === t ? 'active' : ''}`}
                      onClick={() => setTab(t)}
                    >
                      {t === 'charts' ? 'Parametric Sweeps' : t === 'scenarios' ? `Design Scenarios (${scenarios.length})` : t === 'sustain' ? 'Strategies' : 'Assumptions & Export'}
                    </button>
                  ))}
                </div>

                <div className="drawer-content">
                  {tab === 'charts' && (
                    <div className="drawer-grid">
                      <div className="drawer-chart-card">
                        <div className="drawer-card-title">HVAC Load vs Outdoor Temperature (Live)</div>
                        <TempSweepChart data={tempSweep} />
                      </div>
                      <div className="drawer-chart-card">
                        <div className="drawer-card-title">Solar Irradiance vs Transmitted Gain</div>
                        <SolarSweepChart data={solarSweep} />
                      </div>
                      <div className="drawer-chart-card">
                        <div className="drawer-card-title">Heating / Cooling Split (kW)</div>
                        <SimpleBar data={[{ name: 'Heating', value: +heatKW.toFixed(2) }, { name: 'Cooling', value: +coolKW.toFixed(2) }, { name: 'Solar gain', value: +(results.solarGainW / 1000).toFixed(2) }]} />
                      </div>
                      <div className="drawer-chart-card">
                        <div className="drawer-card-title">Envelope Conduction Magnitude (|Q| W)</div>
                        <SimpleBar data={results.transmissionByComponent.map((c) => ({ name: c.label, value: +c.valueW.toFixed(0) }))} />
                      </div>
                      <div className="drawer-chart-card">
                        <div className="drawer-card-title">{siteLocation ? `Site Climate Scenarios (kW)` : `Climate Presets (kW)`}</div>
                        <GroupedBar data={presetCompare} series={[{ key: 'heating_kW', color: '#e06c75' }, { key: 'cooling_kW', color: '#5e7a88' }]} />
                      </div>
                      {monthlyLoads && (
                        <div className="drawer-chart-card">
                          <div className="drawer-card-title">
                            {climate ? 'Monthly Weather Mean Loads (kW)' : `Monthly Seasonal Loads for ${siteClimate?.location.name ?? 'site'} (kW)`}
                          </div>
                          <GroupedBar data={monthlyLoads} series={[{ key: 'heating_kW', color: '#e06c75' }, { key: 'cooling_kW', color: '#5e7a88' }]} />
                        </div>
                      )}
                      {scenarioRows.length > 1 && (
                        <div className="drawer-chart-card">
                          <div className="drawer-card-title">Scenario Energy Comparison (kW)</div>
                          <GroupedBar data={scenarioRows} series={[{ key: 'heating_kW', color: '#e06c75' }, { key: 'cooling_kW', color: '#5e7a88' }, { key: 'solar_kW', color: '#e5a83b' }]} />
                        </div>
                      )}
                    </div>
                  )}

                  {tab === 'scenarios' && (
                    <div style={{ padding: 12 }}>
                      <div className="btnrow" style={{ marginBottom: 12 }}>
                        <button className="btn primary" onClick={saveScenario}>＋ Save current design as scenario</button>
                        <button className="btn" disabled={scenarios.length === 0} onClick={() => { setScenarios([]); setBaselineId(null); }}>Restore baseline (clear all)</button>
                      </div>
                      {scenarios.length === 0 && (
                        <div className="hint" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          No scenarios saved yet. Use scenarios to compare alternative glazing, insulation, and shading options against baseline.
                        </div>
                      )}
                      {scenarios.map((s) => {
                        const r = resultsFor(s);
                        const isBase = baseline && baseline.id === s.id;
                        return (
                          <div key={s.id} className="selcard" style={{ marginTop: 8 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input
                                className="txt" value={s.name} style={{ maxWidth: 220 }}
                                onChange={(e) => setScenarios((sc) => sc.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                                aria-label="Scenario name"
                              />
                              {isBase && <span className="badge ok">baseline</span>}
                              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{new Date(s.createdAt).toLocaleString()}</span>
                              <div style={{ flex: 1 }} />
                              <button className="btn" onClick={() => { setBaselineId(s.id); setNotice({ kind: 'ok', text: `"${s.name}" set as baseline.` }); }}>Set baseline</button>
                              <button className="btn" onClick={() => { setEnv({ ...s.env }); setDesign(JSON.parse(JSON.stringify(s.design))); setNotice({ kind: 'ok', text: `Restored "${s.name}" into live controls.` }); }}>Restore</button>
                              <button className="btn" onClick={() => { const c = { ...s, id: uuid(), name: s.name + ' (copy)' }; setScenarios((sc) => [...sc, c]); }}>Duplicate</button>
                              <button className="btn danger" onClick={() => { setScenarios((sc) => sc.filter((x) => x.id !== s.id)); if (baselineId === s.id) setBaselineId(null); }}>Delete</button>
                            </div>
                            <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--text-muted)' }} className="mono">
                              heat {(r.heatingLoadW / 1000).toFixed(2)} kW • cool {(r.coolingLoadW / 1000).toFixed(2)} kW • solar {(r.solarGainW / 1000).toFixed(2)} kW • EUI {r.euiIllustrative?.toFixed(1) ?? 'n/a'} • WWR {(s.design.wwr.value * 100).toFixed(0)}%
                            </div>
                          </div>
                        );
                      })}
                      {scenarios.length >= 1 && baseline && (
                        <div style={{ overflowX: 'auto', marginTop: 14 }}>
                          <table className="cmp">
                            <thead>
                              <tr><th>Scenario vs “{baseline.name}”</th><th>Δ heat kW</th><th>Δ cool kW</th><th>Δ EUI</th></tr>
                            </thead>
                            <tbody>
                              {scenarios.map((s) => {
                                const r = resultsFor(s);
                                const dh = r.heatingLoadW / 1000 - baselineResults!.heatingLoadW / 1000;
                                const dc = r.coolingLoadW / 1000 - baselineResults!.coolingLoadW / 1000;
                                const de = r.euiIllustrative != null && baselineResults!.euiIllustrative != null ? r.euiIllustrative - baselineResults!.euiIllustrative! : null;
                                return (
                                  <tr key={s.id}>
                                    <td>{s.name}</td>
                                    <td>{dh.toFixed(2)} ({pct(dh, baselineResults!.heatingLoadW / 1000)})</td>
                                    <td>{dc.toFixed(2)} ({pct(dc, baselineResults!.coolingLoadW / 1000)})</td>
                                    <td>{de != null ? `${de.toFixed(1)} (${pct(de, baselineResults!.euiIllustrative ?? 0)})` : 'n/a'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === 'sustain' && (
                    <div style={{ padding: 12, fontSize: 12.5 }}>
                      <div className="section-title">Envelope Upgrades</div>
                      <div className="btnrow" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <button className="btn" onClick={() => { setD('glazingU', 0.8); setD('shgc', 0.25); }}>Triple Glazing (U 0.8, SHGC 0.25)</button>
                        <button className="btn" onClick={() => setD('shadingFactor', 0.55)}>External Louvers (×0.55)</button>
                        <button className="btn" onClick={() => setD('wallU', 0.2)}>Wall Insulation+ (U 0.2)</button>
                        <button className="btn" onClick={() => setD('roofU', 0.15)}>Roof Insulation+ (U 0.15)</button>
                        <button className="btn" onClick={() => setD('wwr', 0.3)}>Optimize WWR → 30%</button>
                      </div>
                      <div className="section-title" style={{ marginTop: 16 }}>Passive Solar &amp; Natural Ventilation</div>
                      <div style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        Current orientation: {design.orientationDeg}° • WWR: {(design.wwr.value * 100).toFixed(0)}% • Shading transmit: ×{design.shadingFactor.value} • Glazing SHGC: {design.shgc.value}.
                        Natural ventilation potential: <strong className={results.natVentPotential === 'high' ? 'g' : results.natVentPotential === 'moderate' ? 'a' : 'r'}>{results.natVentPotential.toUpperCase()}</strong>. {results.natVentNote}
                      </div>
                      {vsBase && baseline && (
                        <div className="hint" style={{ marginTop: 10, color: 'var(--text-muted)' }}>
                          vs baseline “{baseline.name}”: Δ cooling {vsBase.cool >= 0 ? '+' : ''}{vsBase.cool.toFixed(2)} kW
                          ({pct(vsBase.cool, baselineResults!.coolingLoadW / 1000)}) • Δ heating {vsBase.heat >= 0 ? '+' : ''}{vsBase.heat.toFixed(2)} kW
                          ({pct(vsBase.heat, baselineResults!.heatingLoadW / 1000)})
                          {vsBase.eui != null ? ` • Δ EUI ${vsBase.eui >= 0 ? '+' : ''}${vsBase.eui.toFixed(1)}` : ''}.
                        </div>
                      )}
                    </div>
                  )}

                  {tab === 'data' && (
                    <div style={{ padding: 12, fontSize: 12 }}>
                      <div className="section-title">Calculation Methodology (ISO 13790 Analytical Engine)</div>
                      <div style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        Q = U·A·ΔT per component (ΔT = setpoint − outdoor) • Solar = G·A·SHGC·shade • Ventilation = 0.33·ACH·V·ΔT •
                        HVAC Load = (transmission + ventilation) − solar − internal gains.
                      </div>
                      <div className="btnrow" style={{ marginTop: 12 }}>
                        <button className="btn" onClick={() => downloadText('analysis.json', toJson(bundle()), 'application/json')}>Download JSON</button>
                        <button className="btn" onClick={() => downloadText('analysis.csv', toCsv(bundle()), 'text/csv')}>Download CSV</button>
                        <button className="btn primary" onClick={persist}>Save Project Locally</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Unified High-Density CAD Inspector */}
        <aside className="cad-inspector">
          {/* Segmented Navigation Tabs */}
          <div className="inspector-tabs">
            <button
              className={`inspector-tab ${inspectorTab === 'envelope' ? 'active' : ''}`}
              onClick={() => setInspectorTab('envelope')}
              title="Building Envelope & Physics"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: 4 }}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              Envelope
            </button>
            <button
              className={`inspector-tab ${inspectorTab === 'climate' ? 'active' : ''}`}
              onClick={() => setInspectorTab('climate')}
              title="Site Climate & Atmosphere"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: 4 }}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              Climate
            </button>
            <button
              className={`inspector-tab ${inspectorTab === 'specs' ? 'active' : ''}`}
              onClick={() => setInspectorTab('specs')}
              title="Performance & Energy Specs"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: 4 }}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Specs
            </button>
            <button
              className={`inspector-tab ${inspectorTab === 'model' ? 'active' : ''}`}
              onClick={() => setInspectorTab('model')}
              title="Scene Outliner & Collections"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: 4 }}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Outliner
            </button>
          </div>

          <div className="inspector-content">
            {/* Selected Element Floating Banner */}
            {selected && (
              <div className="inspector-sel-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 12.5, color: 'var(--text-lead)' }}>{selected.name}</strong>
                  <button className="btn-close" onClick={() => setSelectedId(null)} title="Clear selection">✕</button>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>{selected.category} · {selected.areaM2} m²</span>
                  {selected.areaProvenance && <Prov v={{ value: 0, provenance: selected.areaProvenance }} />}
                  {selected.uValueWm2K ? <span>· {selected.uValueWm2K} W/m²K</span> : null}
                  {selected.uProvenance && <Prov v={{ value: 0, provenance: selected.uProvenance }} />}
                </div>
              </div>
            )}

            {/* TAB 1: ENVELOPE CONTROLS */}
            {inspectorTab === 'envelope' && (
              <div className="inspector-tab-pane">
                <div className="inspector-sec-head">GLAZING &amp; FABRIC</div>
                <Slider label="Window-to-wall ratio" value={+design.wwr.value.toFixed(2)} min={0.05} max={0.9} step={0.01} unit="" onChange={(v) => setD('wwr', v)} prov={design.wwr} tip="Target glazing share of the wall band. Rescales glazing vs opaque wall conserving total band area." />
                <Slider label="Wall U-value" value={design.wallU.value} min={0.1} max={3} step={0.05} unit="W/m²K" onChange={(v) => setD('wallU', v)} prov={design.wallU} />
                <Slider label="Roof U-value" value={design.roofU.value} min={0.1} max={3} step={0.05} unit="W/m²K" onChange={(v) => setD('roofU', v)} prov={design.roofU} />
                <Slider label="Glazing U-value" value={design.glazingU.value} min={0.5} max={5.8} step={0.1} unit="W/m²K" onChange={(v) => setD('glazingU', v)} prov={design.glazingU} />
                <Slider label="SHGC" value={design.shgc.value} min={0.05} max={0.9} step={0.01} unit="" onChange={(v) => setD('shgc', v)} prov={design.shgc} tip="Solar heat gain coefficient of the glazing (0–1)." />
                <Slider label="External shading transmit" value={design.shadingFactor.value} min={0.1} max={1} step={0.05} unit="" onChange={(v) => setD('shadingFactor', v)} prov={design.shadingFactor} tip="Fraction of sun transmitted after external shading." />

                <div className="inspector-sec-head" style={{ marginTop: 14 }}>VENTILATION &amp; GAINS</div>
                <Slider label="Infiltration" value={design.infiltrationACH} min={0} max={3} step={0.1} unit="ACH" onChange={(v) => setDesign((d) => ({ ...d, infiltrationACH: v }))} tip="Air changes per hour. Q_vent = 0.33·ACH·V·ΔT." />
                <Slider label="Internal gains" value={design.internalGainsWm2} min={0} max={30} step={0.5} unit="W/m²" onChange={(v) => setDesign((d) => ({ ...d, internalGainsWm2: v }))} tip="Occupants + equipment + lighting per floor m²." />
                <Slider label="Orientation" value={design.orientationDeg} min={0} max={360} step={5} unit="°" onChange={(v) => setDesign((d) => ({ ...d, orientationDeg: v }))} tip="Orientation azimuth." />

                <div className="inspector-sec-head" style={{ marginTop: 14 }}>PASSIVE GREENERY</div>
                <button
                  type="button"
                  className={`cad-toggle-btn ${design.naturalVentilationOn ? 'active' : ''}`}
                  onClick={() => setDesign((d) => ({ ...d, naturalVentilationOn: !d.naturalVentilationOn }))}
                  title="Toggle natural ventilation modeling"
                >
                  <span className="cad-toggle-label">Natural Ventilation</span>
                  <span className="cad-toggle-pill">
                    <span className="cad-toggle-dot" />
                    <span className="cad-toggle-text">{design.naturalVentilationOn ? 'ON' : 'OFF'}</span>
                  </span>
                </button>
                <Slider label="Openable fraction" value={design.ventilationOpenableFraction} min={0} max={0.6} step={0.05} unit="" onChange={(v) => setDesign((d) => ({ ...d, ventilationOpenableFraction: v }))} />
                <Slider label="Green roof share" value={design.greenRoofFraction} min={0} max={1} step={0.1} unit="" onChange={(v) => setDesign((d) => ({ ...d, greenRoofFraction: v }))} tip="Illustrative: effective roof U × (1 − 0.25·share)." />
                <Slider label="Green wall share" value={design.greenWallFraction} min={0} max={1} step={0.1} unit="" onChange={(v) => setDesign((d) => ({ ...d, greenWallFraction: v }))} tip="Illustrative: effective wall U × (1 − 0.15·share)." />

                <div className="btnrow" style={{ marginTop: 12 }}>
                  <button className="btn" onClick={resetToModel}>Reset to Model IFC Values</button>
                </div>
              </div>
            )}

            {/* TAB 2: CLIMATE & LOCATION */}
            {inspectorTab === 'climate' && (
              <div className="inspector-tab-pane">
                <div className="inspector-sec-head">SITE LOCATION &amp; WEATHER</div>
                <div className="loc-search-box">
                  <div className="loc-input-wrap">
                    <input
                      className="loc-input"
                      type="text"
                      placeholder="Search site location (London, Dubai, Tokyo)..."
                      value={locSearchQuery}
                      onChange={(e) => handleSearchQueryChange(e.target.value)}
                      onFocus={() => { if (locSuggestions.length > 0) setShowLocDropdown(true); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); executeSearchNow(); } }}
                      aria-label="Site location search"
                    />
                    {locSearchQuery && (
                      <button
                        className="loc-clear-btn"
                        title="Clear search"
                        onClick={() => { setLocSearchQuery(''); setLocSuggestions([]); setShowLocDropdown(false); }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <button
                    className="btn"
                    style={{ padding: '7px 11px', whiteSpace: 'nowrap' }}
                    onClick={executeSearchNow}
                    disabled={isSearchingLoc}
                    title="Search site location"
                  >
                    {isSearchingLoc ? '⏳' : 'Find'}
                  </button>

                  {showLocDropdown && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 45 }} onClick={() => setShowLocDropdown(false)} />
                      <div className="loc-dropdown">
                        {locSuggestions.length > 0 ? (
                          locSuggestions.map((loc) => (
                            <button
                              key={`${loc.id}-${loc.latitude}`}
                              className="loc-item"
                              onClick={() => handleSelectLocation(loc)}
                            >
                              <span className="loc-item-title">
                                📍 {loc.name}{loc.admin1 ? `, ${loc.admin1}` : ''}
                                <span style={{ fontWeight: 400, color: 'var(--text-faint)', fontSize: 11 }}>({loc.country})</span>
                              </span>
                              <span className="loc-item-sub">
                                {loc.latitude.toFixed(2)}°N, {loc.longitude.toFixed(2)}°E {loc.elevation != null ? ` • Alt: ${loc.elevation}m` : ''}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>No matching locations found.</div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {!siteLocation && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Site presets:</div>
                    <div className="loc-popular-pills">
                      {POPULAR_SITES.slice(0, 6).map((site) => (
                        <button key={site.id} className="loc-pill" onClick={() => handleSelectLocation(site)}>
                          📍 {site.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {siteClimate && !isLoadingClimate && (
                  <div className="site-card" style={{ marginTop: 8 }}>
                    <div className="site-card-header">
                      <div>
                        <div className="site-name">📍 {siteClimate.location.name}, {siteClimate.location.country}</div>
                        <div className="site-coords">{siteClimate.location.latitude.toFixed(2)}°N, {siteClimate.location.longitude.toFixed(2)}°E</div>
                      </div>
                      <span className="site-weather-badge">{siteClimate.isDay ? '☀️' : '🌙'} {siteClimate.weatherLabel}</span>
                    </div>

                    <div className="site-modes" style={{ marginTop: 6 }}>
                      <button className={activeClimateMode === 'current' ? 'active' : ''} onClick={() => handleApplyClimateMode('current')}>🕒 Live</button>
                      <button className={activeClimateMode === 'daylight' ? 'active' : ''} onClick={() => handleApplyClimateMode('daylight')}>☀️ Peak Solar</button>
                      <button className={activeClimateMode === 'summer' ? 'active' : ''} onClick={() => handleApplyClimateMode('summer')}>🔥 Summer</button>
                      <button className={activeClimateMode === 'winter' ? 'active' : ''} onClick={() => handleApplyClimateMode('winter')}>❄️ Winter</button>
                    </div>

                    <div className="site-actions" style={{ marginTop: 6 }}>
                      <button className="btn" onClick={refreshSiteClimate} title="Re-fetch live weather">🔄 Sync</button>
                      <button className="btn" onClick={clearSiteLocation} title="Clear site">✕ Change</button>
                    </div>
                  </div>
                )}

                <div className="inspector-sec-head" style={{ marginTop: 14 }}>CLIMATE ARCHETYPES</div>
                <div className="presets" style={{ marginBottom: 12 }}>
                  <button className={activeArchetype === 'arid' && !siteLocation ? 'active' : ''} onClick={() => handleApplyArchetype('arid')}>Arid</button>
                  <button className={activeArchetype === 'tropical' && !siteLocation ? 'active' : ''} onClick={() => handleApplyArchetype('tropical')}>Tropical</button>
                  <button className={activeArchetype === 'temperate' && !siteLocation ? 'active' : ''} onClick={() => handleApplyArchetype('temperate')}>Temperate</button>
                </div>

                <div className="inspector-sec-head">BOUNDARY CONDITIONS</div>
                <Slider label="Outdoor air temp" value={env.outdoorTempC} min={-10} max={50} step={0.5} unit="°C" onChange={(v) => set('outdoorTempC', v)} tip="Dry-bulb outdoor temperature." />
                <Slider label="Solar radiation" value={env.solarIrradianceWm2} min={0} max={1200} step={10} unit="W/m²" onChange={(v) => set('solarIrradianceWm2', v)} tip="User-supplied incident irradiance on the glazing plane." />
                <Slider label="Cloud cover" value={env.cloudCoverPct} min={0} max={100} step={1} unit="%" onChange={(v) => set('cloudCoverPct', v)} tip="Informational cloud cover." />
                <Slider label="Wind speed" value={env.windSpeedMs} min={0} max={20} step={0.5} unit="m/s" onChange={(v) => set('windSpeedMs', v)} tip="Feeds natural ventilation & free-cooling credit." />
                <Slider label="Relative humidity" value={env.relHumidityPct} min={0} max={100} step={1} unit="%" onChange={(v) => set('relHumidityPct', v)} />
                <Slider label="Indoor setpoint" value={env.indoorSetpointC} min={16} max={28} step={0.5} unit="°C" onChange={(v) => set('indoorSetpointC', v)} tip="Heating/cooling comfort setpoint." />
              </div>
            )}

            {/* TAB 3: PERFORMANCE & SPECS */}
            {inspectorTab === 'specs' && (
              <div className="inspector-tab-pane">
                <div className="inspector-sec-head">PERFORMANCE METRICS</div>
                <div className="kpis">
                  <div className="kpi">
                    <span className="label">Operative Temp</span>
                    <span className="big">{results.operativeTempMaintainedC.toFixed(1)}<span style={{ fontSize: 12, color: 'var(--text-muted)' }}> °C</span></span>
                    <span className="sub">{results.comfortStatus} · free {results.operativeTempFreeC.toFixed(1)}°C</span>
                  </div>

                  <div className="kpi">
                    <span className="label">HVAC Demand ({results.activeMode})</span>
                    <span className="big">{(Math.max(heatKW, coolKW)).toFixed(1)}<span style={{ fontSize: 12, color: 'var(--text-muted)' }}> kW</span></span>
                    <span className="sub">heat {heatKW.toFixed(1)} · cool {coolKW.toFixed(1)} kW</span>
                  </div>

                  <div className="kpi">
                    <span className="label">Solar Heat Gain</span>
                    <span className="big">{(results.solarGainW / 1000).toFixed(1)}<span style={{ fontSize: 12, color: 'var(--text-muted)' }}> kW</span></span>
                    <span className="sub">transmitted irradiance</span>
                  </div>

                  <div className="kpi">
                    <span className="label">Annual EUI</span>
                    <span className="big">{eui?.toFixed(0) ?? '—'}<span style={{ fontSize: 12, color: 'var(--text-muted)' }}> kWh/m²</span></span>
                    <span className="sub">target: {design.euiTargetKwhM2Yr} kWh/m²</span>
                  </div>
                </div>

                <div className="inspector-sec-head" style={{ marginTop: 14 }}>ENVELOPE SURFACES</div>
                <table className="spec-table">
                  <thead>
                    <tr>
                      <th>Surface</th>
                      <th style={{ textAlign: 'right' }}>Area (m²)</th>
                      <th style={{ textAlign: 'right' }}>U (W/m²K)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Opaque Walls</td>
                      <td style={{ textAlign: 'right' }}>{scaled.opaqueWallM2.toFixed(1)}</td>
                      <td style={{ textAlign: 'right' }}>{design.wallU.value.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Glazing (WWR {(design.wwr.value * 100).toFixed(0)}%)</td>
                      <td style={{ textAlign: 'right' }}>{scaled.glazingM2.toFixed(1)}</td>
                      <td style={{ textAlign: 'right' }}>{design.glazingU.value.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Roof Assembly</td>
                      <td style={{ textAlign: 'right' }}>{summary.roofArea.toFixed(1)}</td>
                      <td style={{ textAlign: 'right' }}>{design.roofU.value.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Ground Slab</td>
                      <td style={{ textAlign: 'right' }}>{model.floorAreaM2.toFixed(1)}</td>
                      <td style={{ textAlign: 'right' }}>—</td>
                    </tr>
                  </tbody>
                </table>

                <div className="inspector-sec-head" style={{ marginTop: 14 }}>EMBODIED &amp; OPERATIONAL CARBON</div>
                <div style={{ fontSize: 11.5, background: 'var(--bg-surface)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--rule)' }} className="mono">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Operational CO₂:</span>
                    <strong style={{ color: 'var(--text-lead)' }}>{results.carbonKgPerYr?.toFixed(0) ?? '—'} kg/yr</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Carbon Intensity:</span>
                    <span style={{ color: 'var(--text-body)' }}>{results.carbonKgPerYr && model.floorAreaM2 ? (results.carbonKgPerYr / model.floorAreaM2).toFixed(1) : '—'} kg/m²·yr</span>
                  </div>
                </div>
                {results.warnings.slice(0, 2).map((w, i) => <div key={i} className="warnbox">• {w}</div>)}
              </div>
            )}

            {/* TAB 4: BLENDER SCENE OUTLINER */}
            {inspectorTab === 'model' && (
              <div className="inspector-tab-pane">
                <div className="blender-outliner-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13 }}>🗂</span>
                    <span className="outliner-title">Scene Collection</span>
                  </div>
                  <span className="outliner-count">{model.elements.length} items</span>
                </div>

                <div className="outliner-filter-wrap">
                  <input
                    className="outliner-filter-input"
                    placeholder="Search collections & elements…"
                    aria-label="Filter elements"
                    value={invFilter}
                    onChange={(e) => setInvFilter(e.target.value)}
                  />
                  {invFilter && (
                    <button className="btn-close" onClick={() => setInvFilter('')}>✕</button>
                  )}
                </div>

                <div className="blender-outliner-tree">
                  {/* Root Collection: Project Building Model */}
                  <div className="outliner-item collection-root">
                    <span className="outliner-chevron">▼</span>
                    <span className="outliner-folder-icon">🏢</span>
                    <span className="outliner-name-strong">{model.name}</span>
                    <span className="outliner-badge">{model.floorAreaM2} m²</span>
                  </div>

                  {/* Grouped Collections (Storeys / Levels) */}
                  {groupedElements.map(([storeyName, elements]) => {
                    const isCollapsed = !!collapsedStoreys[storeyName];
                    const firstCat = elements[0]?.category;
                    const allCatVisible = firstCat ? visibleTypes[firstCat] !== false : true;

                    return (
                      <div key={storeyName} className="outliner-collection-group">
                        <div
                          className="outliner-item storey-row"
                          onClick={() => toggleStorey(storeyName)}
                        >
                          <span className="outliner-chevron">{isCollapsed ? '▶' : '▼'}</span>
                          <span className="outliner-folder-icon">📂</span>
                          <span className="outliner-name">{storeyName}</span>
                          <span className="outliner-count-pill">{elements.length}</span>
                          <button
                            className={`outliner-eye-btn ${allCatVisible ? 'active' : 'dim'}`}
                            title="Toggle layer visibility"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (firstCat) {
                                setVisibleTypes((v) => ({ ...v, [firstCat]: !v[firstCat] }));
                              }
                            }}
                          >
                            👁
                          </button>
                        </div>

                        {/* Storey Children Elements */}
                        {!isCollapsed && (
                          <div className="outliner-children">
                            {elements.slice(0, 150).map((e) => {
                              const isSelected = selectedId === e.id;
                              const isCatVisible = visibleTypes[e.category] !== false;
                              const catIcon =
                                e.category === 'wall' ? '🧱' :
                                e.category === 'window' ? '🪟' :
                                e.category === 'roof' ? '🏠' :
                                e.category === 'floor' ? '📐' : '🏗';

                              return (
                                <div
                                  key={e.id}
                                  className={`outliner-item element-row ${isSelected ? 'active' : ''}`}
                                  onClick={() => setSelectedId(e.id)}
                                >
                                  <span className="outliner-elem-icon">{catIcon}</span>
                                  <div className="outliner-elem-info">
                                    <span className="outliner-elem-name">{e.name}</span>
                                    <span className="outliner-elem-meta">{e.areaM2} m² {e.uValueWm2K ? `· U ${e.uValueWm2K}` : ''}</span>
                                  </div>
                                  <button
                                    className={`outliner-eye-btn ${isCatVisible ? 'active' : 'dim'}`}
                                    title={`Toggle ${e.category} visibility`}
                                    onClick={(eEvt) => {
                                      eEvt.stopPropagation();
                                      setVisibleTypes((v) => ({ ...v, [e.category]: !v[e.category] }));
                                    }}
                                  >
                                    👁
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ================= dialogs ================= */}
      {dlg === 'bim' && (
        <div className="modal-back" onClick={() => !importBusy && setDlg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Import BIM model</h3>
            <div style={{ fontSize: 12, color: '#93a1b8', marginBottom: 8 }}>
              Supported: <strong>IFC (.ifc)</strong> STEP — walls, windows, doors, slabs, roofs, storeys, materials,
              property &amp; quantity sets. Native Revit <strong>.rvt is not parseable</strong> — export to IFC from Revit first.
              Also accepts normalized exchange <strong>.json</strong>. The viewer shows the <em>actual imported elements</em>, never a substitute shape.
            </div>
            <div
              className="dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleBimFile(f); }}
            >
              Drop .ifc / .json here or click to browse
              <input
                ref={fileInputRef} type="file" accept=".ifc,.json" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBimFile(f); e.target.value = ''; }}
              />
            </div>
            {importBusy && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12 }}>Parsing… {importProgress}%</div>
                <div className="progress"><div style={{ width: `${importProgress}%` }} /></div>
                <div className="btnrow" style={{ marginTop: 6 }}>
                  <button className="btn danger" onClick={() => { cancelRef.current = true; }}>Cancel</button>
                </div>
              </div>
            )}
            {importLog.length > 0 && <pre className="log" style={{ marginTop: 8 }}>{importLog.join('\n')}</pre>}
            <div className="btnrow" style={{ marginTop: 10 }}>
              <button className="btn" onClick={loadSample}>Use sample building instead</button>
              <button className="btn" onClick={() => setDlg(null)} disabled={importBusy}>Close</button>
            </div>
          </div>
        </div>
      )}

      {dlg === 'climate' && (
        <div className="modal-back" onClick={() => setDlg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Import climate data (CSV)</h3>
            <div style={{ fontSize: 12, color: '#93a1b8', marginBottom: 8 }}>
              Documented format — header: <span className="mono">timestamp,outdoorTempC,solarWm2,relHumidityPct,windMs[,cloudPct]</span> •
              units °C, W/m², %, m/s. EPW is <em>not</em> parsed — convert to this CSV first. Single-row files set one snapshot only
              (no annual results are then claimed).
            </div>
            <div className="btnrow">
              <button className="btn" onClick={() => climateInputRef.current?.click()}>Upload CSV…</button>
              <button className="btn" onClick={() => downloadText('sample-weather.csv', SAMPLE_CLIMATE_CSV, 'text/csv')}>Download sample CSV</button>
              <input
                ref={climateInputRef} type="file" accept=".csv" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleClimateFile(f); e.target.value = ''; }}
              />
            </div>
            {climate && (
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <strong>Preview</strong> ({climate.rows.length} rows){' '}
                {climate.warnings.slice(0, 4).map((w, i) => <div key={i} className="warnbox">• {w}</div>)}
                <div style={{ overflowX: 'auto' }}>
                  <table className="cmp">
                    <thead><tr><th>timestamp</th><th>T °C</th><th>solar</th><th>RH%</th><th>wind</th></tr></thead>
                    <tbody>
                      {climate.rows.slice(0, 8).map((r, i) => (
                        <tr key={i}>
                          <td>{r.timestamp}</td><td>{r.outdoorTempC}</td><td>{r.solarWm2}</td>
                          <td>{r.relHumidityPct}</td><td>{r.windMs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="hint" style={{ color: '#64748b' }}>First row already applied to live conditions; monthly means drive the monthly chart.</div>
              </div>
            )}
            <div className="btnrow" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setDlg(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {dlg === 'plugins' && (
        <div className="modal-back" onClick={() => setDlg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Active plugins / integrations</h3>
            {INTEGRATIONS.map((i) => (
              <div key={i.name} className="selcard" style={{ marginTop: 6 }}>
                <span className={`dot ${i.status === 'connected' ? 'green' : i.status === 'not-configured' ? 'amber' : 'grey'}`} />{' '}
                <strong>{i.name}</strong> — <em style={{ color: '#93a1b8' }}>{i.status.replace('-', ' ')}</em>
                <div style={{ color: '#93a1b8', fontSize: 12 }}>{i.detail}</div>
              </div>
            ))}
            <div className="btnrow" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setDlg(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {dlg === 'settings' && (
        <div className="modal-back" onClick={() => setDlg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Settings</h3>
            <div className="ctl">
              <div className="row"><label>Project name</label></div>
              <input className="txt" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>
            <div className="ctl">
              <div className="row"><label>EUI target (kWh/m²/yr) — user-set reference, not a regulation</label><span className="val">{design.euiTargetKwhM2Yr}</span></div>
              <input type="range" min={20} max={250} step={5} value={design.euiTargetKwhM2Yr} onChange={(e) => setDesign((d) => ({ ...d, euiTargetKwhM2Yr: Number(e.target.value) }))} />
            </div>
            <div className="ctl">
              <div className="row"><label>Carbon factor (kgCO₂/kWh)</label><span className="val">{design.carbonFactorKgPerKwh}</span></div>
              <input type="range" min={0} max={1} step={0.05} value={design.carbonFactorKgPerKwh} onChange={(e) => setDesign((d) => ({ ...d, carbonFactorKgPerKwh: Number(e.target.value) }))} />
            </div>
            <div className="ctl">
              <div className="row"><label>Equivalent heating hours (illustrative annualization)</label><span className="val">{design.equivHeatingHours} h</span></div>
              <input type="range" min={0} max={3000} step={50} value={design.equivHeatingHours} onChange={(e) => setDesign((d) => ({ ...d, equivHeatingHours: Number(e.target.value) }))} />
            </div>
            <div className="ctl">
              <div className="row"><label>Equivalent cooling hours</label><span className="val">{design.equivCoolingHours} h</span></div>
              <input type="range" min={0} max={4000} step={50} value={design.equivCoolingHours} onChange={(e) => setDesign((d) => ({ ...d, equivCoolingHours: Number(e.target.value) }))} />
            </div>
            <div className="btnrow" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={() => { persist(); setDlg(null); }}>Save project</button>
              <button className="btn" onClick={() => setDlg(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {dlg === 'help' && (
        <div className="modal-back" onClick={() => setDlg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Methodology &amp; documentation</h3>
            <div style={{ fontSize: 13, color: '#c6d2e4' }}>
              <p><strong>Workflow:</strong> BIM import → geometry/material extraction → climate configuration → analytical heat balance → dashboard → report export.</p>
              <p><strong>Physics (single-zone steady-state):</strong> Q = U·A·ΔT per component; solar G·A·SHGC·shade (G used directly — cloud never rescales it);
                ventilation 0.33·ACH·V·ΔT; HVAC = fabric + ventilation − solar − internal gains. Heating/cooling are instantaneous kW estimates.</p>
              <p><strong>Honest limits:</strong> no thermal mass, no solar geometry, no HVAC curves, no CFD airflow, no Radiance daylight run —
                so daylight is a <em>potential index</em> (not DA) and EUI is an <em>illustrative annualization</em> (load × equivalent hours ÷ floor area).</p>
              <p><strong>Provenance tags:</strong> green = extracted from BIM, blue = user-supplied, amber = assumption, red = unknown.</p>
              <p><strong>Files:</strong> IFC (.ifc) STEP for models; climate CSV with header
                <span className="mono"> timestamp,outdoorTempC,solarWm2,relHumidityPct,windMs[,cloudPct]</span>. RVT must be exported to IFC first.</p>
              <p><strong>Exports</strong> reflect live state: PDF report, CSV, JSON. <strong>Persistence</strong> is local (localStorage + IndexedDB), not a server.</p>
            </div>
            <div className="btnrow" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setDlg(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
