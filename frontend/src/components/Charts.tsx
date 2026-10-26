import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { isDark } from '../telegram'

export const PALETTE = ['#16A34A', '#1E4D80', '#F59E0B', '#0EA5E9', '#DC2626', '#7C3AED', '#14B8A6', '#DB2777', '#65A30D', '#64748B']

function axisColor() {
  return isDark() ? '#9AABBE' : '#5B6B80'
}

const tooltipStyle = { borderRadius: 12, border: '1px solid #DCE3EC', fontSize: 14 }

export function LineChartView({ data, height = 220 }: { data: { label: string; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor() }} interval="preserveStartEnd" minTickGap={20} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: axisColor() }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="value" stroke="#16A34A" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function BarChartView({ data, height = 240 }: { data: { label: string; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: axisColor() }}
          interval={0}
          tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + '…' : v)}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: axisColor() }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="value" radius={[8, 8, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function PieChartView({ data, height = 220 }: { data: { label: string; value: number }[]; height?: number }) {
  const nonZero = data.filter((d) => d.value > 0)
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={nonZero} dataKey="value" nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={2}>
            {nonZero.map((d) => (
              <Cell key={d.label} fill={PALETTE[data.indexOf(d) % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        {data.map((d, i) => (
          <span key={d.label} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            {d.label}: <b>{d.value}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Horizontal percentage bars: easiest to read on a phone. */
export function PercentBars({ items }: { items: { label: string; count: number; percent: number; muted?: boolean }[] }) {
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[15px]">
            <span className={it.muted ? 'text-muted line-through' : ''}>{it.label}</span>
            <span className="shrink-0 font-bold">
              {it.percent}% <span className="font-normal text-muted">({it.count})</span>
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${it.percent}%`, background: PALETTE[i % PALETTE.length] }} />
          </div>
        </div>
      ))}
    </div>
  )
}
