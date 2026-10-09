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

export function TempSweepChart({ data }: { data: { tOut: number; heatingW: number; coolingW: number }[] }) {
  const rows = data.map((d) => ({
    t: d.tOut,
    heating_kW: +(d.heatingW / 1000).toFixed(2),
    cooling_kW: +(d.coolingW / 1000).toFixed(2),
  }));
  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={rows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="#1e2942" strokeDasharray="3 3" />
        <XAxis dataKey="t" stroke="#93a1b8" fontSize={11} label={{ value: 'T_out °C', fill: '#64748b', fontSize: 10, position: 'insideBottomRight', offset: -2 }} />
        <YAxis stroke="#93a1b8" fontSize={11} />
        <Tooltip contentStyle={{ background: '#0d1628', border: '1px solid #26314d', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="heating_kW" stroke="#f87171" dot={false} strokeWidth={2} name="Heating kW" />
        <Line type="monotone" dataKey="cooling_kW" stroke="#38bdf8" dot={false} strokeWidth={2} name="Cooling kW" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SolarSweepChart({ data }: { data: { solar: number; gainW: number }[] }) {
  const rows = data.map((d) => ({ solar: d.solar, gain_kW: +(d.gainW / 1000).toFixed(2) }));
  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={rows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="#1e2942" strokeDasharray="3 3" />
        <XAxis dataKey="solar" stroke="#93a1b8" fontSize={11} label={{ value: 'W/m²', fill: '#64748b', fontSize: 10, position: 'insideBottomRight' }} />
        <YAxis stroke="#93a1b8" fontSize={11} />
        <Tooltip contentStyle={{ background: '#0d1628', border: '1px solid #26314d', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="gain_kW" stroke="#fbbf24" dot={false} strokeWidth={2} name="Solar gain kW" />
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
      <BarChart data={data} margin={{ top: 5, right: 10, left: -6, bottom: 0 }}>
        <CartesianGrid stroke="#1e2942" strokeDasharray="3 3" />
        <XAxis dataKey="name" stroke="#93a1b8" fontSize={10} interval={0} angle={-18} dy={8} height={52} />
        <YAxis stroke="#93a1b8" fontSize={11} />
        <Tooltip contentStyle={{ background: '#0d1628', border: '1px solid #26314d', fontSize: 12 }} />
        <Bar dataKey="value" fill="#38bdf8" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GroupedBar({
  data,
  series,
  height = 220,
}: {
  data: Record<string, string | number | null>[];
  series: { key: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -6, bottom: 0 }}>
        <CartesianGrid stroke="#1e2942" strokeDasharray="3 3" />
        <XAxis dataKey="name" stroke="#93a1b8" fontSize={10} interval={0} angle={-18} dy={8} height={56} />
        <YAxis stroke="#93a1b8" fontSize={11} />
        <Tooltip contentStyle={{ background: '#0d1628', border: '1px solid #26314d', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
