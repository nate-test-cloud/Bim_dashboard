/** CSV climate import: documented format + validation + preview. */

export interface ClimateRow {
  timestamp: string;
  outdoorTempC: number;
  solarWm2: number;
  relHumidityPct: number;
  windMs: number;
  cloudPct?: number;
}

export interface ClimateTable {
  rows: ClimateRow[];
  warnings: string[];
  monthlyAverages: { month: string; tAvgC: number; solarWm2: number }[];
}

const REQUIRED = ['timestamp', 'outdoortempc', 'solarwm2', 'relhumiditypct', 'windms'];

export function parseClimateCsv(text: string): ClimateTable {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('CSV has no data rows. Expected a header plus at least one data row.');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const missing = REQUIRED.filter((r) => !header.includes(r));
  if (missing.length)
    throw new Error(
      `Missing required columns: ${missing.join(', ')}. Expected header: timestamp,outdoorTempC,solarWm2,relHumidityPct,windMs[,cloudPct]. Units: °C, W/m², %, m/s.`,
    );
  const idx = (name: string) => header.indexOf(name);
  const rows: ClimateRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim());
    if (cells.length < header.length) {
      warnings.push(`Row ${i}: only ${cells.length} cells — skipped.`);
      continue;
    }
    const num = (col: string, lo: number, hi: number, label: string): number | null => {
      const v = Number(cells[idx(col)]);
      if (!Number.isFinite(v)) {
        warnings.push(`Row ${i}: ${label} "${cells[idx(col)]}" is not numeric — row skipped.`);
        return null;
      }
      if (v < lo || v > hi) {
        warnings.push(`Row ${i}: ${label} ${v} outside plausible range [${lo}, ${hi}] — row skipped.`);
        return null;
      }
      return v;
    };
    const t = num('outdoortempc', -60, 60, 'outdoorTempC');
    const s = num('solarwm2', 0, 1400, 'solarWm2');
    const h = num('relhumiditypct', 0, 100, 'relHumidityPct');
    const w = num('windms', 0, 60, 'windMs');
    const ts = cells[idx('timestamp')];
    if (t === null || s === null || h === null || w === null) continue;
    if (!ts || Number.isNaN(Date.parse(ts)) && !/^\d{4}-\d{2}/.test(ts)) {
      warnings.push(`Row ${i}: timestamp "${ts}" not parseable — kept as label only.`);
    }
    const ci = idx('cloudpct');
    const cloud = ci >= 0 && cells[ci] !== '' ? Number(cells[ci]) : undefined;
    rows.push({
      timestamp: ts,
      outdoorTempC: t,
      solarWm2: s,
      relHumidityPct: h,
      windMs: w,
      cloudPct: cloud !== undefined && Number.isFinite(cloud) ? cloud : undefined,
    });
  }
  if (rows.length === 0) throw new Error('No valid data rows after validation. See warnings for details.');
  if (rows.length === 1)
    warnings.push('Single snapshot imported — annual/monthly results cannot be derived from one row.');
  return { rows, warnings, monthlyAverages: toMonthly(rows) };
}

function toMonthly(rows: ClimateRow[]): { month: string; tAvgC: number; solarWm2: number }[] {
  // Group by YYYY-MM when parseable, else single "Imported" bucket average.
  const groups = new Map<string, ClimateRow[]>();
  for (const r of rows) {
    const d = new Date(r.timestamp);
    const key = Number.isNaN(d.getTime()) ? 'Imported' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()].map(([month, rs]) => ({
    month,
    tAvgC: rs.reduce((a, r) => a + r.outdoorTempC, 0) / rs.length,
    solarWm2: rs.reduce((a, r) => a + r.solarWm2, 0) / rs.length,
  }));
}

export const SAMPLE_CLIMATE_CSV = `# Sample weather snapshot series — monthly design means (illustrative, not a real station file)
# Format: timestamp,outdoorTempC,solarWm2,relHumidityPct,windMs,cloudPct
timestamp,outdoorTempC,solarWm2,relHumidityPct,windMs,cloudPct
2026-01-01T12:00,8,180,78,4.5,65
2026-02-01T12:00,9,230,72,4.2,60
2026-03-01T12:00,12,380,65,4.0,55
2026-04-01T12:00,15,520,58,3.6,45
2026-05-01T12:00,19,680,52,3.2,35
2026-06-01T12:00,23,800,45,3.0,25
2026-07-01T12:00,26,830,42,2.8,20
2026-08-01T12:00,25,760,46,2.9,25
2026-09-01T12:00,21,580,55,3.3,40
2026-10-01T12:00,16,380,66,3.8,55
2026-11-01T12:00,11,220,74,4.1,65
2026-12-01T12:00,8,150,79,4.4,70
`;
