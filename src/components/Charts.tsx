import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const chartTooltipStyle = {
  background: '#161a22',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '4px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
  padding: '6px 10px',
  fontSize: '11px',
  color: '#f8fafc',
  fontFamily: 'IBM Plex Mono, monospace',
};

export function TempSweepChart({ data }: { data: { tOut: number; heatingW: number; coolingW: number }[] }) {
  const rows = data.map((d) => ({
    t: d.tOut,
    heating_kW: +(d.heatingW / 1000).toFixed(2),
    cooling_kW: +(d.coolingW / 1000).toFixed(2),
  }));
  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={rows} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="2 2" vertical={false} />
        <XAxis
          dataKey="t"
          stroke="rgba(255, 255, 255, 0.15)"
          tick={{ fill: '#8b929e', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
          label={{ value: 'T_out °C', fill: '#8b929e', fontSize: 10, position: 'insideBottomRight', offset: -2 }}
        />
        <YAxis
          stroke="rgba(255, 255, 255, 0.15)"
          tick={{ fill: '#8b929e', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#8b929e', paddingTop: 4 }} />
        <Line type="monotone" dataKey="heating_kW" stroke="#dc2626" dot={false} strokeWidth={1.8} name="Heating (kW)" />
        <Line type="monotone" dataKey="cooling_kW" stroke="#0284c7" dot={false} strokeWidth={1.8} name="Cooling (kW)" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SolarSweepChart({ data }: { data: { solar: number; gainW: number }[] }) {
  const rows = data.map((d) => ({ solar: d.solar, gain_kW: +(d.gainW / 1000).toFixed(2) }));
  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={rows} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="2 2" vertical={false} />
        <XAxis
          dataKey="solar"
          stroke="rgba(255, 255, 255, 0.15)"
          tick={{ fill: '#8b929e', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
          label={{ value: 'W/m²', fill: '#8b929e', fontSize: 10, position: 'insideBottomRight' }}
        />
        <YAxis
          stroke="rgba(255, 255, 255, 0.15)"
          tick={{ fill: '#8b929e', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#8b929e', paddingTop: 4 }} />
        <Line type="monotone" dataKey="gain_kW" stroke="#d97706" dot={false} strokeWidth={1.8} name="Solar gain (kW)" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SimpleBar({
  data,
  height = 210,
}: {
  data: { name: string; value: number; [k: string]: string | number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="2 2" vertical={false} />
        <XAxis
          dataKey="name"
          stroke="rgba(255, 255, 255, 0.15)"
          tick={{ fill: '#8b929e', fontSize: 10 }}
          interval={0}
          angle={-18}
          dy={8}
          height={50}
        />
        <YAxis
          stroke="rgba(255, 255, 255, 0.15)"
          tick={{ fill: '#8b929e', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Bar dataKey="value" fill="#475569" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GroupedBar({
  data,
  series,
  height = 230,
}: {
  data: Record<string, string | number | null>[];
  series: { key: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 14, left: -6, bottom: 0 }}>
        <CartesianGrid stroke="rgba(226, 232, 240, 0.8)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="name"
          stroke="rgba(203, 213, 225, 0.9)"
          tick={{ fill: '#64748b', fontSize: 10.5 }}
          interval={0}
          angle={-18}
          dy={8}
          height={56}
        />
        <YAxis
          stroke="rgba(203, 213, 225, 0.9)"
          tick={{ fill: '#64748b', fontSize: 10.5, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11.5, color: '#475569', paddingTop: 8 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[5, 5, 0, 0]} opacity={0.92} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
