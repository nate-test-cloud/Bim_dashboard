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
  return <span className={`prov ${v.provenance}`}>{PROVENANCE_LABEL[v.provenance]}</span>;
}

function SliderRow(props: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  tip?: string; onChange: (v: number) => void; prov?: ProvValue;
}) {
  return (
    <div className="ctl">
      <div className="row">
        <label>
          {props.tip ? <span className="tooltip" data-tip={props.tip}>{props.label}</span> : props.label}
          {props.prov && <ProvTag v={props.prov} />}
        </label>
        <span className="val">{props.value}<span style={{ color: '#64748b', fontWeight: 400 }}> {props.unit}</span></span>
      </div>
      <input
        type="range" aria-label={props.label}
        min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
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
    if (!climate || climate.monthlyAverages.length < 2) return null;
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
  }, [climate, heatInputs]);

  const presetCompare = useMemo(
    () =>
      (Object.keys(CLIMATE_PRESETS) as (keyof typeof CLIMATE_PRESETS)[]).map((k) => {
        const pr = CLIMATE_PRESETS[k];
        const r = heatBalance({
          ...heatInputs,
          env: { ...heatInputs.env, outdoorTempC: pr.env.outdoorTempC, solarIrradianceWm2: pr.env.solarIrradianceWm2, cloudCoverPct: pr.env.cloudCoverPct, windSpeedMs: pr.env.windSpeedMs, relHumidityPct: pr.env.relHumidityPct },
        });
        return { name: k, heating_kW: +(r.heatingLoadW / 1000).toFixed(2), cooling_kW: +(r.coolingLoadW / 1000).toFixed(2) };
      }),
    [heatInputs],
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

  const applyPreset = (k: keyof typeof CLIMATE_PRESETS) => {
    const pr = CLIMATE_PRESETS[k];
    setEnv((e) => ({ ...e, ...pr.env }));
    setNotice({ kind: 'ok', text: `Climate preset applied: ${pr.label}. Values remain editable.` });
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
      {/* ================= header ================= */}
      <header className="topbar">
        <div className="brand">
          {projectName} <span className="accent">BIM Sustainability Analytics</span>
        </div>
        <span className="badge info" title="BIM import state">{modelStatus}</span>
        <span className="badge warn" title="Simplified physics — not a validated simulation engine">
          Mode: Analytical / Demo
        </span>
        <div style={{ flex: 1 }} />
        <div className="menu">
          <button>▤ File ▾</button>
          <div className="drop">
            <button onClick={() => { setImportLog([]); setImportProgress(0); setDlg('bim'); }}>⇪ Import BIM model (.ifc / .json)</button>
            <button onClick={() => setDlg('climate')}>⇪ Import climate data (CSV)</button>
            <div className="sep" />
            <button onClick={() => { try { exportPdf(bundle()); } catch (e) { setNotice({ kind: 'err', text: `PDF export failed: ${e instanceof Error ? e.message : e}` }); } }}>⤓ Export analytics report (PDF)</button>
            <button onClick={() => downloadText('analysis.csv', toCsv(bundle()), 'text/csv')}>⤓ Export data (CSV)</button>
            <button onClick={() => downloadText('analysis.json', toJson(bundle()), 'application/json')}>⤓ Export data (JSON)</button>
            <div className="sep" />
            <button onClick={persist}>💾 Save project (local)</button>
          </div>
        </div>
        <div className="menu">
          <button>Sustainability ▾</button>
          <div className="drop">
            <button onClick={() => setTab('sustain')}>Building envelope optimization</button>
            <button onClick={() => setTab('sustain')}>Passive solar strategies</button>
            <button onClick={() => setTab('sustain')}>Natural ventilation assessment</button>
            <button onClick={() => setTab('sustain')}>Green roof &amp; wall options</button>
          </div>
        </div>
        <div className="menu">
          <button>Analysis tools ▾</button>
          <div className="drop">
            {INTEGRATIONS.map((i) => (
              <div className="row" key={i.name} style={{ fontSize: 12 }}>
                <span className={`dot ${i.status === 'connected' ? 'green' : i.status === 'not-configured' ? 'amber' : 'grey'}`} />
                {i.name} — <em style={{ color: '#93a1b8' }}>{i.status.replace('-', ' ')}</em>
              </div>
            ))}
          </div>
        </div>
        <div className="menu">
          <button>View ▾</button>
          <div className="drop">
            <button onClick={() => setShowGrid((v) => !v)}>Grid: {showGrid ? 'on' : 'off'}</button>
            <button onClick={() => setShowAxes((v) => !v)}>Axes: {showAxes ? 'on' : 'off'}</button>
            <button onClick={() => setWireframe((v) => !v)}>Wireframe: {wireframe ? 'on' : 'off'}</button>
            <button onClick={() => setAutoRotate((v) => !v)}>Auto-rotate: {autoRotate ? 'on' : 'off'}</button>
          </div>
        </div>
        <div className="menu">
          <button>? Help ▾</button>
          <div className="drop">
            <button onClick={() => setDlg('help')}>Methodology &amp; documentation</button>
            <button onClick={() => setDlg('settings')}>⚙ Settings</button>
          </div>
        </div>
        <button className="btn" onClick={() => setDlg('plugins')}>
          ⚙ Active plugins ({INTEGRATIONS.filter((i) => i.status === 'connected').length} connected)
        </button>
      </header>

      {notice && (
        <div style={{ padding: '6px 14px 0' }}>
          <div className={notice.kind === 'err' ? 'errbox' : notice.kind === 'warn' ? 'warnbox' : 'okbox'}>
            {notice.text} <button className="btn" style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => setNotice(null)}>dismiss</button>
          </div>
        </div>
      )}

      {/* ================= workspace ================= */}
      <div className="workspace">
        {/* -------- left -------- */}
        <aside className="panel leftcol">
          <h2 className="section-title">Model &amp; environmental controls</h2>

          <details className="coll" open>
            <summary>① Climate presets</summary>
            <div className="body">
              <div className="presets">
                {(Object.keys(CLIMATE_PRESETS) as (keyof typeof CLIMATE_PRESETS)[]).map((k) => (
                  <button key={k} onClick={() => applyPreset(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
                ))}
              </div>
              <div className="hint" style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                Each preset sets a coherent outdoor snapshot; every value stays editable afterwards.
              </div>
            </div>
          </details>

          <details className="coll" open>
            <summary>② Environmental parameters</summary>
            <div className="body">
              <Slider label="Outdoor air temp" value={env.outdoorTempC} min={-10} max={50} step={0.5} unit="°C" onChange={(v) => set('outdoorTempC', v)} tip="Dry-bulb outdoor temperature. ΔT = setpoint − outdoor drives Q = U·A·ΔT." />
              <Slider label="Solar radiation" value={env.solarIrradianceWm2} min={0} max={1200} step={10} unit="W/m²" onChange={(v) => set('solarIrradianceWm2', v)} tip="User-supplied incident irradiance on the glazing plane. Used DIRECTLY in G·A·SHGC·shade — cloud cover is never silently applied." />
              <Slider label="Cloud cover" value={env.cloudCoverPct} min={0} max={100} step={1} unit="%" onChange={(v) => set('cloudCoverPct', v)} tip="Informational only. It does NOT rescale your solar input; supply measured irradiance directly." />
              <Slider label="Wind speed" value={env.windSpeedMs} min={0} max={20} step={0.5} unit="m/s" onChange={(v) => set('windSpeedMs', v)} tip="Feeds the natural-ventilation potential note and free-cooling credit." />
              <Slider label="Relative humidity" value={env.relHumidityPct} min={0} max={100} step={1} unit="%" onChange={(v) => set('relHumidityPct', v)} tip="Displayed for IEQ context; the steady-state heat balance does not model latent loads." />
              <Slider label="Indoor target temp" value={env.indoorSetpointC} min={16} max={28} step={0.5} unit="°C" onChange={(v) => set('indoorSetpointC', v)} tip="Heating/cooling setpoint. Comfort band ≈ 20–24 °C operative." />
              <div className="ctl">
                <div className="row"><label>Analysis date</label></div>
                <input className="txt" type="date" value={env.analysisDate} onChange={(e) => set('analysisDate', e.target.value)} aria-label="Analysis date" />
              </div>
            </div>
          </details>

          <details className="coll" open>
            <summary>③ Building-design parameters</summary>
            <div className="body">
              <Slider label="Window-to-wall ratio" value={+design.wwr.value.toFixed(2)} min={0.05} max={0.9} step={0.01} unit="" onChange={(v) => setD('wwr', v)} prov={design.wwr} tip="Target glazing share of the wall band. Rescales glazing vs opaque wall conserving total band area." />
              <Slider label="Wall U-value" value={design.wallU.value} min={0.1} max={3} step={0.05} unit="W/m²K" onChange={(v) => setD('wallU', v)} prov={design.wallU} />
              <Slider label="Roof U-value" value={design.roofU.value} min={0.1} max={3} step={0.05} unit="W/m²K" onChange={(v) => setD('roofU', v)} prov={design.roofU} />
              <Slider label="Glazing U-value" value={design.glazingU.value} min={0.5} max={5.8} step={0.1} unit="W/m²K" onChange={(v) => setD('glazingU', v)} prov={design.glazingU} />
              <Slider label="SHGC" value={design.shgc.value} min={0.05} max={0.9} step={0.01} unit="" onChange={(v) => setD('shgc', v)} prov={design.shgc} tip="Solar heat gain coefficient of the glazing (0–1)." />
              <Slider label="External shading transmit" value={design.shadingFactor.value} min={0.1} max={1} step={0.05} unit="" onChange={(v) => setD('shadingFactor', v)} prov={design.shadingFactor} tip="Fraction of sun transmitted after external shading. 1 = unshaded, 0.5 = deep fins/overhangs." />
              <Slider label="Infiltration" value={design.infiltrationACH} min={0} max={3} step={0.1} unit="ACH" onChange={(v) => setDesign((d) => ({ ...d, infiltrationACH: v }))} tip="Air changes per hour. Q_vent = 0.33·ACH·V·ΔT." />
              <Slider label="Internal gains" value={design.internalGainsWm2} min={0} max={30} step={0.5} unit="W/m²" onChange={(v) => setDesign((d) => ({ ...d, internalGainsWm2: v }))} tip="Occupants + equipment + lighting per floor m²." />
              <Slider label="Orientation" value={design.orientationDeg} min={0} max={360} step={5} unit="°" onChange={(v) => setDesign((d) => ({ ...d, orientationDeg: v }))} tip="Informational for passive-solar notes. The simplified engine applies no hidden orientation multiplier." />
              <div className="btnrow" style={{ marginTop: 8 }}>
                <button className="btn" onClick={resetToModel}>Reset to model values</button>
              </div>
            </div>
          </details>

          <details className="coll">
            <summary>④ Ventilation &amp; greenery</summary>
            <div className="body">
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={design.naturalVentilationOn} onChange={(e) => setDesign((d) => ({ ...d, naturalVentilationOn: e.target.checked }))} />
                Enable natural ventilation
              </label>
              <Slider label="Openable fraction" value={design.ventilationOpenableFraction} min={0} max={0.6} step={0.05} unit="" onChange={(v) => setDesign((d) => ({ ...d, ventilationOpenableFraction: v }))} />
              <Slider label="Green roof share" value={design.greenRoofFraction} min={0} max={1} step={0.1} unit="" onChange={(v) => setDesign((d) => ({ ...d, greenRoofFraction: v }))} tip="Illustrative: effective roof U × (1 − 0.25·share)." />
              <Slider label="Green wall share" value={design.greenWallFraction} min={0} max={1} step={0.1} unit="" onChange={(v) => setDesign((d) => ({ ...d, greenWallFraction: v }))} tip="Illustrative: effective wall U × (1 − 0.15·share)." />
            </div>
          </details>

          <details className="coll">
            <summary>⑤ Model inventory ({model.elements.length})</summary>
            <div className="body" style={{ fontSize: 12 }}>
              <div>Storeys: {model.storeys.join(', ') || '—'} • Spaces: {model.spaces}</div>
              {model.elements.some((e) => e.category === 'structure') && (
                <div style={{ color: '#64748b', marginTop: 2 }}>
                  Incl. {model.elements.filter((e) => e.category === 'structure').length} structural parts
                  (viewer only — excluded from heat calculations).
                </div>
              )}
              <input
                className="txt" placeholder="Filter elements…" aria-label="Filter elements"
                value={invFilter} onChange={(e) => setInvFilter(e.target.value)}
                style={{ marginTop: 6 }}
              />
              <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
                {filteredInv.slice(0, 250).map((e) => (
                  <button
                    key={e.id}
                    className="btn"
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4, borderColor: selectedId === e.id ? '#38bdf8' : undefined }}
                    onClick={() => setSelectedId(e.id)}
                  >
                    {e.name} <span style={{ color: '#64748b' }}>· {e.category} · {e.areaM2} m²</span>
                  </button>
                ))}
              </div>
              {filteredInv.length > 250 && (
                <div style={{ color: '#64748b' }}>Showing 250 of {filteredInv.length} — refine the filter to find more.</div>
              )}
            </div>
          </details>
        </aside>

        {/* -------- center -------- */}
        <main className="centercol">
          <section className="panel">
            <h2 className="section-title">3D BIM viewer — {model.name}</h2>
            <Viewer3D
              model={model}
              wireframe={wireframe}
              showGrid={showGrid}
              showAxes={showAxes}
              visibleTypes={visibleTypes}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              autoRotate={autoRotate}
            />
            <div className="btnrow" style={{ marginTop: 8 }}>
              {(['wall', 'window', 'door', 'roof', 'floor', 'structure'] as const).map((t) => (
                <button
                  key={t}
                  className="btn"
                  style={{ borderColor: visibleTypes[t] ? undefined : '#7f1d1d' }}
                  onClick={() => setVisibleTypes((v) => ({ ...v, [t]: !v[t] }))}
                  aria-pressed={visibleTypes[t]}
                >
                  {t}s: {visibleTypes[t] ? 'shown' : 'hidden'}
                </button>
              ))}
              <button className="btn" onClick={() => setWireframe((v) => !v)}>Wireframe {wireframe ? 'on' : 'off'}</button>
              <button className="btn" onClick={loadSample}>Sample building</button>
              <button className="btn" onClick={loadDemoTower}>Demo tower</button>
              <button className="btn primary" onClick={() => { setImportLog([]); setImportProgress(0); setDlg('bim'); }}>Import BIM…</button>
            </div>
            {selected ? (
              <div className="selcard" style={{ marginTop: 8 }}>
                <strong>{selected.name}</strong> <span style={{ color: '#64748b' }}>· {selected.category}{selected.ifcType ? ` · ${selected.ifcType}` : ''}{selected.globalId ? ` · ${selected.globalId.slice(0, 12)}…` : ''}</span>
                <div style={{ marginTop: 4 }}>
                  Area: <span className="mono">{selected.areaM2} m²</span><Prov v={{ value: 0, provenance: selected.areaProvenance }} />
                  {'  '}U: <span className="mono">{selected.uValueWm2K ?? '—'} {selected.uValueWm2K ? 'W/m²K' : ''}</span>
                  {selected.uProvenance && <Prov v={{ value: 0, provenance: selected.uProvenance }} />}
                </div>
                <div style={{ color: '#93a1b8' }}>
                  Material: {selected.material ?? 'unknown'}
                  {selected.materialProvenance && <Prov v={{ value: 0, provenance: selected.materialProvenance }} />}
                  {selected.storey ? ` · Storey: ${selected.storey}` : ''}
                </div>
              </div>
            ) : (
              <div className="hint" style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                Click any element in the viewport (or the inventory list) to inspect its properties. Missing values show a red “Unknown” tag and can be covered by design assumptions.
              </div>
            )}
            {model.warnings.length > 0 && (
              <div className="warnbox">
                {model.warnings.map((w, i) => <div key={i}>• {w}</div>)}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="tabs">
              {(['charts', 'scenarios', 'sustain', 'data'] as const).map((t) => (
                <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t === 'charts' ? 'Charts & trends' : t === 'scenarios' ? `Scenarios (${scenarios.length})` : t === 'sustain' ? 'Sustainability features' : 'Data & assumptions'}
                </button>
              ))}
            </div>

            {tab === 'charts' && (
              <div>
                <h2 className="section-title">HVAC load vs outdoor temperature (live)</h2>
                <TempSweepChart data={tempSweep} />
                <h2 className="section-title" style={{ marginTop: 12 }}>Solar radiation vs transmitted solar gain (live)</h2>
                <SolarSweepChart data={solarSweep} />
                <h2 className="section-title" style={{ marginTop: 12 }}>Heating / cooling split at current conditions (kW)</h2>
                <SimpleBar data={[{ name: 'Heating', value: +heatKW.toFixed(2) }, { name: 'Cooling', value: +coolKW.toFixed(2) }, { name: 'Solar gain', value: +(results.solarGainW / 1000).toFixed(2) }]} />
                <h2 className="section-title" style={{ marginTop: 12 }}>Envelope conduction magnitude by component (W, |Q|)</h2>
                <SimpleBar data={results.transmissionByComponent.map((c) => ({ name: c.label, value: +c.valueW.toFixed(0) }))} />
                <h2 className="section-title" style={{ marginTop: 12 }}>Climate presets vs current design (kW)</h2>
                <GroupedBar data={presetCompare} series={[{ key: 'heating_kW', color: '#f87171' }, { key: 'cooling_kW', color: '#38bdf8' }]} />
                {monthlyLoads ? (
                  <>
                    <h2 className="section-title" style={{ marginTop: 12 }}>Monthly mean-condition loads from imported weather (kW snapshots — not integrated kWh)</h2>
                    <GroupedBar data={monthlyLoads} series={[{ key: 'heating_kW', color: '#f87171' }, { key: 'cooling_kW', color: '#38bdf8' }]} />
                  </>
                ) : (
                  <div className="hint" style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                    Import a multi-row climate CSV to enable the monthly chart. Single snapshots cannot produce annual results.
                  </div>
                )}
                {scenarioRows.length > 1 && (
                  <>
                    <h2 className="section-title" style={{ marginTop: 12 }}>Scenario energy comparison (kW)</h2>
                    <GroupedBar data={scenarioRows} series={[{ key: 'heating_kW', color: '#f87171' }, { key: 'cooling_kW', color: '#38bdf8' }, { key: 'solar_kW', color: '#fbbf24' }]} />
                  </>
                )}
              </div>
            )}

            {tab === 'scenarios' && (
              <div>
                <div className="btnrow">
                  <button className="btn primary" onClick={saveScenario}>＋ Save current as scenario</button>
                  <button className="btn" disabled={scenarios.length === 0} onClick={() => { setScenarios([]); setBaselineId(null); }}>Restore baseline (clear all)</button>
                </div>
                {scenarios.length === 0 && (
                  <div className="hint" style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                    No scenarios yet. Example workflow — Baseline: existing glazing + insulation + current climate →
                    A: improved glazing + shading → B: better roof + lower WWR. Then compare below.
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
                        <span style={{ fontSize: 11, color: '#64748b' }}>{new Date(s.createdAt).toLocaleString()}</span>
                        <div style={{ flex: 1 }} />
                        <button className="btn" onClick={() => { setBaselineId(s.id); setNotice({ kind: 'ok', text: `"${s.name}" set as baseline.` }); }}>Set baseline</button>
                        <button className="btn" onClick={() => { setEnv({ ...s.env }); setDesign(JSON.parse(JSON.stringify(s.design))); setNotice({ kind: 'ok', text: `Restored "${s.name}" into the live controls.` }); }}>Restore</button>
                        <button className="btn" onClick={() => { const c = { ...s, id: uuid(), name: s.name + ' (copy)' }; setScenarios((sc) => [...sc, c]); }}>Duplicate</button>
                        <button className="btn danger" onClick={() => { setScenarios((sc) => sc.filter((x) => x.id !== s.id)); if (baselineId === s.id) setBaselineId(null); }}>Delete</button>
                      </div>
                      <div style={{ fontSize: 12, marginTop: 4 }} className="mono">
                        heat {(r.heatingLoadW / 1000).toFixed(2)} kW • cool {(r.coolingLoadW / 1000).toFixed(2)} kW •
                        solar {(r.solarGainW / 1000).toFixed(2)} kW • EUI {r.euiIllustrative?.toFixed(1) ?? 'n/a'} •
                        WWR {(s.design.wwr.value * 100).toFixed(0)}% • U_win {s.design.glazingU.value} • shade {s.design.shadingFactor.value}
                      </div>
                    </div>
                  );
                })}
                {scenarios.length >= 1 && baseline && (
                  <div style={{ overflowX: 'auto' }}>
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
                    <div className="hint" style={{ fontSize: 11, color: '#64748b' }}>
                      Alternatives are compared, never labelled “optimal” — no optimization was run.
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'sustain' && (
              <div style={{ fontSize: 13 }}>
                <h2 className="section-title">Building envelope optimization</h2>
                <div className="btnrow">
                  <button className="btn" onClick={() => { setD('glazingU', 0.8); setD('shgc', 0.25); }}>Improved glazing (U 0.8, SHGC 0.25)</button>
                  <button className="btn" onClick={() => setD('shadingFactor', 0.55)}>External shading (×0.55)</button>
                  <button className="btn" onClick={() => setD('wallU', 0.2)}>Wall insulation+ (U 0.2)</button>
                  <button className="btn" onClick={() => setD('roofU', 0.15)}>Roof insulation+ (U 0.15)</button>
                  <button className="btn" onClick={() => setD('wwr', 0.3)}>Reduce WWR → 30%</button>
                </div>
                {vsBase && baseline && (
                  <div className="hint" style={{ marginTop: 6, color: '#93a1b8' }}>
                    vs baseline “{baseline.name}”: Δ cooling {vsBase.cool >= 0 ? '+' : ''}{vsBase.cool.toFixed(2)} kW
                    ({pct(vsBase.cool, baselineResults!.coolingLoadW / 1000)}) • Δ heating {vsBase.heat >= 0 ? '+' : ''}{vsBase.heat.toFixed(2)} kW
                    ({pct(vsBase.heat, baselineResults!.heatingLoadW / 1000)})
                    {vsBase.eui != null ? ` • Δ EUI ${vsBase.eui >= 0 ? '+' : ''}${vsBase.eui.toFixed(1)}` : ''}.
                    EUI target: <span className="mono">{design.euiTargetKwhM2Yr} kWh/m²/yr</span> (configurable in Settings; source: user setting, not a regulation).
                  </div>
                )}
                <h2 className="section-title" style={{ marginTop: 12 }}>Passive solar strategies</h2>
                <div style={{ color: '#93a1b8' }}>
                  Orientation {design.orientationDeg}° • WWR {(design.wwr.value * 100).toFixed(0)}% • shading ×{design.shadingFactor.value} • SHGC {design.shgc.value}.
                  Guidance (qualitative): south-facing glazing with external shading balances winter gain against summer overheating;
                  low SHGC + shading cuts cooling most where irradiance &gt; 600 W/m². No solar-geometry engine is running — these are
                  design prompts, not simulated savings.
                </div>
                <h2 className="section-title" style={{ marginTop: 12 }}>Natural ventilation assessment (preliminary — no CFD)</h2>
                <div>
                  Potential: <strong className={results.natVentPotential === 'high' ? 'g' : results.natVentPotential === 'moderate' ? 'a' : 'r'}>
                    {results.natVentPotential.toUpperCase()}
                  </strong>
                  <div style={{ color: '#93a1b8' }}>{results.natVentNote}</div>
                </div>
                <h2 className="section-title" style={{ marginTop: 12 }}>Green roof &amp; wall options</h2>
                <div style={{ color: '#93a1b8' }}>
                  Green roof {(design.greenRoofFraction * 100).toFixed(0)}% → effective roof U{' '}
                  {(heatInputs.uValues.roofU).toFixed(2)} W/m²K; green wall {(design.greenWallFraction * 100).toFixed(0)}% → effective
                  wall U {(heatInputs.uValues.wallU).toFixed(2)} W/m²K. Adjust shares in the left panel; scenario comparison above
                  quantifies the change. Evapotranspiration and stormwater effects are not modelled.
                </div>
                <h2 className="section-title" style={{ marginTop: 12 }}>Analysis tools / integrations</h2>
                {INTEGRATIONS.map((i) => (
                  <div key={i.name} className="selcard" style={{ marginTop: 6 }}>
                    <span className={`dot ${i.status === 'connected' ? 'green' : i.status === 'not-configured' ? 'amber' : 'grey'}`} />{' '}
                    <strong>{i.name}</strong> — <em style={{ color: '#93a1b8' }}>{i.status.replace('-', ' ')}</em>
                    <div style={{ color: '#93a1b8' }}>{i.detail}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'data' && (
              <div style={{ fontSize: 12 }}>
                <h2 className="section-title">Calculation methodology (analytical demo)</h2>
                <div style={{ color: '#93a1b8' }}>
                  Q = U·A·ΔT per component (ΔT = setpoint − outdoor, + = loss) • Solar G·A·SHGC·shade with the
                  user-supplied G used directly (cloud is informational) • Ventilation 0.33·ACH·V·ΔT •
                  HVAC = (transmission + ventilation) − solar − internal • Free-running T = T<sub>out</sub> + (solar + internal)/(ΣUA + H<sub>ve</sub>) •
                  Daylight “potential” is an index, not validated DA • EUI is illustrative (load × equivalent full-load hours ÷ floor area).
                  Full equations: <span className="mono">src/lib/calculations.ts</span>.
                </div>
                <h2 className="section-title" style={{ marginTop: 10 }}>Provenance of current inputs</h2>
                <div className="mono" style={{ color: '#93a1b8' }}>
                  <div>Wall U {design.wallU.value} [{design.wallU.provenance}] • Roof U {design.roofU.value} [{design.roofU.provenance}] • Glazing U {design.glazingU.value} [{design.glazingU.provenance}]</div>
                  <div>SHGC {design.shgc.value} [{design.shgc.provenance}] • Shading {design.shadingFactor.value} [{design.shadingFactor.provenance}] • WWR {(design.wwr.value * 100).toFixed(0)}% [{design.wwr.provenance}]</div>
                  <div>Floor {model.floorAreaM2} m² [{model.floorAreaProvenance}] • Volume {model.volumeM3} m³ [{model.volumeProvenance}] • Geometry: {model.geometryFidelity}</div>
                </div>
                {(results.warnings.length > 0 || model.warnings.length > 0) && (
                  <div className="warnbox">
                    {[...model.warnings, ...results.warnings].map((w, i) => <div key={i}>• {w}</div>)}
                  </div>
                )}
                <div className="btnrow" style={{ marginTop: 8 }}>
                  <button className="btn" onClick={() => downloadText('analysis.json', toJson(bundle()), 'application/json')}>Download JSON</button>
                  <button className="btn" onClick={() => downloadText('analysis.csv', toCsv(bundle()), 'text/csv')}>Download CSV</button>
                  <button className="btn" onClick={persist}>Save project locally</button>
                </div>
              </div>
            )}
          </section>
        </main>

        {/* -------- right -------- */}
        <aside className="panel rightcol">
          <h2 className="section-title">Live performance analytics</h2>
          <div className="section-title" style={{ border: 'none', padding: 0 }}>Indoor Environmental Quality</div>
          <div className="kpis">
            <div className="kpi">
              <div className="label"><span className="tooltip" data-tip="Maintained operative temperature ≈ setpoint when HVAC is active, else the free-running estimate. Comfort band 20–24.5 °C.">Operative temp</span></div>
              <div className={`big ${results.operativeTempMaintainedC > 26.5 || results.operativeTempMaintainedC < 20 ? 'r' : results.operativeTempMaintainedC > 24.5 ? 'a' : 'g'}`}>
                {results.operativeTempMaintainedC.toFixed(1)}°C
              </div>
              <div className="sub">{results.comfortStatus} • free-running {results.operativeTempFreeC.toFixed(1)}°C</div>
            </div>
            <div className="kpi">
              <div className="label"><span className="tooltip" data-tip="Daylight POTENTIAL index — explicitly NOT validated Daylight Autonomy, which needs annual Radiance simulation.">Daylight potential*</span></div>
              <div className="big a">{results.daylightPotentialPct}%</div>
              <div className="sub">*indicator only, not DA</div>
            </div>
            <div className="kpi">
              <div className="label">Rel. humidity (input)</div>
              <div className="big b">{env.relHumidityPct}%</div>
              <div className="sub">{env.relHumidityPct > 70 ? 'humid — latent loads unmodelled' : env.relHumidityPct < 30 ? 'dry' : 'moderate'}</div>
            </div>
            <div className="kpi">
              <div className="label">Nat. vent potential</div>
              <div className={`big ${results.natVentPotential === 'high' ? 'g' : results.natVentPotential === 'moderate' ? 'a' : 'r'}`}>
                {results.natVentPotential}
              </div>
              <div className="sub">wind {env.windSpeedMs} m/s</div>
            </div>
          </div>

          <div className="section-title" style={{ marginTop: 12 }}>Energy performance (instantaneous loads)</div>
          <div className="kpis">
            <div className="kpi">
              <div className="label"><span className="tooltip" data-tip="Mechanical power needed NOW at stated conditions — not energy (kWh) and not annual EUI.">HVAC {results.activeMode}</span></div>
              <div className={`big ${results.activeMode === 'cooling' ? 'b' : results.activeMode === 'heating' ? 'r' : 'g'}`}>
                {(Math.max(heatKW, coolKW)).toFixed(2)}<span style={{ fontSize: 12 }}> kW</span>
              </div>
              <div className="sub">heat {heatKW.toFixed(2)} • cool {coolKW.toFixed(2)} kW</div>
              <div className="bar"><div style={{ width: `${Math.min(100, Math.max(heatKW, coolKW) * 8)}%`, background: results.activeMode === 'heating' ? '#f87171' : '#38bdf8' }} /></div>
              {vsBase && <div className="sub">vs baseline Δ {(heatKW - baselineResults!.heatingLoadW / 1000 + coolKW - baselineResults!.coolingLoadW / 1000 >= 0 ? '+' : '')}{(heatKW - baselineResults!.heatingLoadW / 1000 + coolKW - baselineResults!.coolingLoadW / 1000).toFixed(2)} kW</div>}
            </div>
            <div className="kpi">
              <div className="label"><span className="tooltip" data-tip="Illustrative annualization: (heat×heat-hours + cool×cool-hours)/floor area. Configure hours in Settings. NOT a simulated annual result.">EUI illustrative*</span></div>
              <div className={`big ${eui != null && eui <= design.euiTargetKwhM2Yr ? 'g' : eui != null && eui <= design.euiTargetKwhM2Yr * 1.4 ? 'a' : 'r'}`}>
                {eui?.toFixed(0) ?? 'n/a'}<span style={{ fontSize: 12 }}> kWh/m²/yr</span>
              </div>
              <div className="sub">target {design.euiTargetKwhM2Yr} (user-set) • {results.annualEnergyKwh?.toFixed(0)} kWh/yr</div>
            </div>
            <div className="kpi">
              <div className="label">Solar heat gain</div>
              <div className="big a">{(results.solarGainW / 1000).toFixed(2)}<span style={{ fontSize: 12 }}> kW</span></div>
              <div className="sub">G·A·SHGC·shade</div>
            </div>
            <div className="kpi">
              <div className="label">Envelope ΔT flow</div>
              <div className="big mono">{results.transmissionTotalW >= 0 ? '+' : ''}{(results.transmissionTotalW / 1000).toFixed(2)}<span style={{ fontSize: 12 }}> kW</span></div>
              <div className="sub">+ = loss • ΔT {results.deltaTK.toFixed(1)} K</div>
            </div>
          </div>

          <div className="section-title" style={{ marginTop: 12 }}>Envelope performance</div>
          <div style={{ fontSize: 12 }} className="mono">
            <div>Exterior: {summary.totalExterior.toFixed(1)} m² (wall {summary.wallArea.toFixed(1)} + win {summary.windowArea.toFixed(1)} + roof {summary.roofArea.toFixed(1)} + door {summary.doorArea.toFixed(1)})</div>
            <div>Effective glazing {(scaled.glazingM2).toFixed(1)} m² @ WWR {(design.wwr.value * 100).toFixed(0)}% • opaque wall {scaled.opaqueWallM2.toFixed(1)} m²</div>
            <div>Air volume {model.volumeM3} m³ • floor {model.floorAreaM2} m²</div>
            <div>Carbon est: {results.carbonKgPerYr?.toFixed(0) ?? 'n/a'} kgCO₂/yr @ {design.carbonFactorKgPerKwh} kg/kWh</div>
          </div>
          {results.warnings.slice(0, 3).map((w, i) => <div key={i} className="warnbox">• {w}</div>)}
        </aside>
      </div>

      <footer className="footer-note">
        Analytical/demo mode — simplified steady-state physics for design comparison, not validated simulation or compliance. Extracted vs user vs assumption values are tagged throughout. No integration is shown as connected unless it genuinely is.
      </footer>

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
