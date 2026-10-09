/** CSV / JSON exports of the live analysis state + PDF report via jsPDF. */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { BuildingModel, CalcResults, DesignInputs, EnvInputs, Scenario } from './types';
import { summarizeEnvelope } from './calculations';

export interface ExportBundle {
  projectName: string;
  model: BuildingModel;
  env: EnvInputs;
  design: DesignInputs;
  results: CalcResults;
  scenarios: Scenario[];
  scenarioResults: { name: string; heatingKW: number; coolingKW: number; eui: number | null; solarKW: number }[];
}

export function toCsv(b: ExportBundle): string {
  const s = summarizeEnvelope(b.model);
  const lines = [
    'section,metric,value,unit,provenance_or_note',
    `project,name,"${b.projectName}",-,local analysis`,
    `model,name,"${b.model.name}",-,source:${b.model.source}`,
    `model,schema,${b.model.schema ?? 'n/a'},-,${b.model.geometryFidelity} geometry`,
    `envelope,wallArea,${s.wallArea.toFixed(1)},m2,derived from elements`,
    `envelope,windowArea,${s.windowArea.toFixed(1)},m2,derived from elements`,
    `envelope,roofArea,${s.roofArea.toFixed(1)},m2,derived from elements`,
    `envelope,totalExterior,${s.totalExterior.toFixed(1)},m2,derived`,
    `envelope,wwr,${(s.wwr * 100).toFixed(1)},%,derived`,
    `envelope,wallU,${b.design.wallU.value},W/m2K,${b.design.wallU.provenance}`,
    `envelope,roofU,${b.design.roofU.value},W/m2K,${b.design.roofU.provenance}`,
    `envelope,glazingU,${b.design.glazingU.value},W/m2K,${b.design.glazingU.provenance}`,
    `envelope,shgc,${b.design.shgc.value},-,${b.design.shgc.provenance}`,
    `environment,outdoorTemp,${b.env.outdoorTempC},C,user control`,
    `environment,solarIrradiance,${b.env.solarIrradianceWm2},W/m2,user-supplied (used directly)`,
    `environment,cloudCover,${b.env.cloudCoverPct},%,informational only`,
    `environment,wind,${b.env.windSpeedMs},m/s,user control`,
    `environment,relHumidity,${b.env.relHumidityPct},%,user control`,
    `environment,indoorSetpoint,${b.env.indoorSetpointC},C,user control`,
    `results,mode,${b.results.mode},-,analytical demo (not validated simulation)`,
    `results,transmissionTotal,${b.results.transmissionTotalW.toFixed(1)},W,Q=U·A·ΔT summed`,
    `results,solarGain,${b.results.solarGainW.toFixed(1)},W,G·A·SHGC·shade`,
    `results,heatingLoad,${b.results.heatingLoadW.toFixed(1)},W,instantaneous estimate`,
    `results,coolingLoad,${b.results.coolingLoadW.toFixed(1)},W,instantaneous estimate`,
    `results,operativeTemp,${b.results.operativeTempMaintainedC.toFixed(1)},C,simplified steady-state`,
    `results,daylightPotential,${b.results.daylightPotentialPct},%,indicator (NOT validated DA)`,
    `results,euiIllustrative,${b.results.euiIllustrative?.toFixed(1) ?? 'n/a'},kWh/m2/yr,illustrative annualization`,
    `results,carbon,${b.results.carbonKgPerYr?.toFixed(0) ?? 'n/a'},kgCO2/yr,est. via carbon factor`,
    ...b.results.components.map(
      (c) => `component,${c.label},${c.qW.toFixed(1)},W,"A=${c.areaM2.toFixed(1)} m2, U=${c.uValue}"`,
    ),
    ...b.scenarioResults.map(
      (r) =>
        `scenario,"${r.name}",heating=${(r.heatingKW).toFixed(2)}kW;cooling=${r.coolingKW.toFixed(2)}kW;eui=${r.eui?.toFixed(1) ?? 'n/a'},-,comparison`,
    ),
  ];
  return lines.join('\n');
}

export function toJson(b: ExportBundle): string {
  return JSON.stringify(
    {
      project: b.projectName,
      exportedAt: new Date().toISOString(),
      analysisMode: 'analytical-demo',
      methodology:
        'Steady-state Q=U·A·ΔT per component; solar G·A·SHGC·shade; ventilation 0.33·ACH·V·ΔT; single-zone heat balance. Simplified — not a validated simulation.',
      units: { temperature: '°C', irradiance: 'W/m²', energy: 'kWh', load: 'W', eui: 'kWh/m²/yr' },
      model: {
        name: b.model.name,
        source: b.model.source,
        sourceFileName: b.model.sourceFileName,
        schema: b.model.schema,
        geometryFidelity: b.model.geometryFidelity,
        warnings: b.model.warnings,
        elements: b.model.elements,
      },
      environment: b.env,
      design: b.design,
      results: b.results,
      scenarios: b.scenarios,
      scenarioComparison: b.scenarioResults,
    },
    null,
    2,
  );
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportPdf(b: ExportBundle): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = 48;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(20, 40, 80);
  doc.text('BIM Sustainability Analytics — Analysis Report', 40, y);
  y += 20;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90);
  doc.text(
    `Integrated Building Envelope Design: A BIM-Based Framework for Sustainability  •  ${new Date().toLocaleString()}  •  Mode: ANALYTICAL / DEMO (not a validated simulation)`,
    40,
    y,
    { maxWidth: W - 80 },
  );
  y += 30;
  const kv: [string, string][] = [
    ['Project', b.projectName],
    ['Model', `${b.model.name}  (source: ${b.model.source}${b.model.sourceFileName ? ` — ${b.model.sourceFileName}` : ''})`],
    ['Schema / fidelity', `${b.model.schema ?? 'n/a'} / ${b.model.geometryFidelity} geometry`],
    [
      'Environment',
      `${b.env.outdoorTempC} °C outdoor, ${b.env.solarIrradianceWm2} W/m² solar (user-supplied, used directly), cloud ${b.env.cloudCoverPct}% (informational), wind ${b.env.windSpeedMs} m/s, RH ${b.env.relHumidityPct}%, setpoint ${b.env.indoorSetpointC} °C`,
    ],
    [
      'Envelope inputs',
      `wall U ${b.design.wallU.value} (${b.design.wallU.provenance}) • roof U ${b.design.roofU.value} (${b.design.roofU.provenance}) • glazing U ${b.design.glazingU.value} (${b.design.glazingU.provenance}) • SHGC ${b.design.shgc.value} • shade factor ${b.design.shadingFactor.value} • WWR target ${(b.design.wwr.value * 100).toFixed(0)}%`,
    ],
  ];
  autoTable(doc, {
    startY: y,
    head: [['Item', 'Detail']],
    body: kv,
    theme: 'grid',
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [15, 40, 80] },
  });
  // @ts-expect-error autotable adds lastAutoTable
  y = doc.lastAutoTable.finalY + 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 40, 80);
  doc.text('Performance results (instantaneous estimates at stated conditions)', 40, y);
  y += 8;
  const r = b.results;
  autoTable(doc, {
    startY: y + 6,
    head: [['Metric', 'Value', 'Note']],
    body: [
      ['HVAC heating load', `${(r.heatingLoadW / 1000).toFixed(2)} kW`, r.activeMode === 'heating' ? 'active mode' : '—'],
      ['HVAC cooling load', `${(r.coolingLoadW / 1000).toFixed(2)} kW`, r.activeMode === 'cooling' ? 'active mode' : '—'],
      ['Envelope transmission', `${r.transmissionTotalW.toFixed(0)} W`, 'Σ U·A·ΔT (+ = loss)'],
      ['Solar gain', `${r.solarGainW.toFixed(0)} W`, 'G·A·SHGC·shade'],
      ['Ventilation flow', `${r.ventilationW.toFixed(0)} W`, '0.33·ACH·V·ΔT'],
      ['Operative temp (maintained)', `${r.operativeTempMaintainedC.toFixed(1)} °C`, `${r.comfortStatus}`],
      ['Daylight potential', `${r.daylightPotentialPct}%`, 'indicator — NOT validated Daylight Autonomy'],
      ['EUI (illustrative)', r.euiIllustrative != null ? `${r.euiIllustrative.toFixed(1)} kWh/m²/yr` : 'n/a', 'annualized via equiv. full-load hours'],
      ['Operational carbon (est.)', r.carbonKgPerYr != null ? `${r.carbonKgPerYr.toFixed(0)} kgCO₂/yr` : 'n/a', 'via carbon factor'],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [15, 40, 80] },
  });
  // @ts-expect-error autotable
  y = doc.lastAutoTable.finalY + 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Component heat flow (signed: + = loss)', 40, y);
  y += 8;
  autoTable(doc, {
    startY: y + 6,
    head: [['Component', 'Area (m²)', 'U (W/m²K)', 'Q (W)']],
    body: r.components.map((c) => [
      c.label,
      c.areaM2.toFixed(1),
      c.uValue.toFixed(2),
      c.qW.toFixed(0),
    ]),
    theme: 'grid',
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [15, 40, 80] },
  });
  // @ts-expect-error autotable
  y = doc.lastAutoTable.finalY + 24;

  if (b.scenarioResults.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Scenario comparison', 40, y);
    y += 8;
    autoTable(doc, {
      startY: y + 6,
      head: [['Scenario', 'Heating (kW)', 'Cooling (kW)', 'Solar (kW)', 'EUI ill.']],
      body: b.scenarioResults.map((s) => [
        s.name,
        s.heatingKW.toFixed(2),
        s.coolingKW.toFixed(2),
        s.solarKW.toFixed(2),
        s.eui != null ? s.eui.toFixed(1) : 'n/a',
      ]),
      theme: 'grid',
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [15, 40, 80] },
    });
    // @ts-expect-error autotable
    y = doc.lastAutoTable.finalY + 24;
  }

  const warnLines = [...b.model.warnings, ...r.warnings];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Methodology, assumptions & missing-data warnings', 40, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(40);
  const method =
    'Single-zone steady-state heat balance at the indoor setpoint. No thermal mass, no solar-position geometry, no HVAC part-load curves, no validated airflow/CFD or Radiance daylight simulation. ' +
    'Cloud cover is informational and is never applied as a hidden multiplier to the user-supplied irradiance. ' +
    'EUI is an illustrative annualization (load × equivalent full-load hours ÷ floor area), not a simulated annual result. ' +
    'Daylight “potential” is an index, not Daylight Autonomy. Results support early design-direction comparison only.';
  const split = doc.splitTextToSize(method, W - 80);
  doc.text(split, 40, y);
  y += split.length * 11 + 8;
  for (const w of warnLines) {
    const ws = doc.splitTextToSize(`• ${w}`, W - 80);
    if (y > 760) {
      doc.addPage();
      y = 48;
    }
    doc.text(ws, 40, y);
    y += ws.length * 11 + 2;
  }
  doc.save(`BIM-Sustainability-Report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
