import { useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  LabelList,
} from 'recharts'
import { PROJECTS, YEARS, type Project } from './data/chaseFieldProjects'
import { effectiveYear, escalatedCost, fmtM, type Overlay } from './phasing'
import { colorForGroup } from './groupColors'

// Brand tokens (reference the same CSS variables defined in index.css).
const GREEN = 'var(--color-pcl-green)'
const ORANGE = 'var(--color-pcl-orange)'
const DARK = 'var(--color-pcl-darkgray)'
const MID = 'var(--color-pcl-midgray)'

// Stable group ordering + name lookup, derived from the existing data.
const GROUPS = Array.from(new Set(PROJECTS.map((p) => p.group))).sort()
const GROUP_NAME: Record<string, string> = {}
for (const p of PROJECTS) GROUP_NAME[p.group] = p.groupName

// A project disrupts the season only if it's explicitly Year-Round; everything
// else (Offseason, or the lone untimed item) counts as Offseason.
const isYearRound = (p: Project) => p.timing === 'Year-Round'

const axisM = (v: number) => `$${(v / 1_000_000).toFixed(0)}M`

function ChartCard({
  title,
  subtitle,
  className = '',
  children,
}: {
  title: string
  subtitle?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={'rounded-lg border border-pcl-lightgray bg-white p-4 shadow-sm ' + className}>
      <div className="mb-2">
        <h2 className="font-condensed text-xl font-bold uppercase tracking-wide text-pcl-darkgray">
          {title}
        </h2>
        {subtitle && <p className="font-sans text-xs text-pcl-midgray">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// Stacked-group tooltip: hide zero segments, sort descending, format $M.
function GroupTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const rows = payload
    .filter((e: any) => e.value > 0)
    .sort((a: any, b: any) => b.value - a.value)
  const total = rows.reduce((s: number, e: any) => s + e.value, 0)
  return (
    <div className="rounded border border-pcl-lightgray bg-white/95 p-2 shadow-md">
      <div className="mb-1 font-condensed text-sm font-bold text-pcl-darkgray">
        {label} · {fmtM(total)}
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.map((e: any) => (
          <div key={e.name} className="flex items-center gap-2 font-sans text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: e.color }} />
            <span className="mr-2 text-pcl-darkgray">{e.name}</span>
            <span className="ml-auto font-condensed font-semibold tabular-nums text-pcl-darkgray">
              {fmtM(e.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Simple $M tooltip for single-series charts.
function ValueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-pcl-lightgray bg-white/95 p-2 shadow-md">
      <div className="font-condensed text-sm font-bold text-pcl-darkgray">{label}</div>
      {payload.map((e: any) => (
        <div key={e.name} className="flex items-center gap-2 font-sans text-xs">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: e.color }} />
          <span className="mr-3 text-pcl-darkgray">{e.name}</span>
          <span className="ml-auto font-condensed font-semibold tabular-nums text-pcl-darkgray">
            {fmtM(e.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function Analytics({ overlay, rate }: { overlay: Overlay; rate: number }) {
  // 1. Spend per year by group (stacked). One row per year, one numeric key per group.
  const byYearGroup = useMemo(() => {
    return YEARS.map((year) => {
      const row: Record<string, number | string> = { year: String(year) }
      for (const g of GROUPS) row[g] = 0
      for (const p of PROJECTS) {
        if (effectiveYear(p, overlay) === year) {
          row[p.group] = (row[p.group] as number) + escalatedCost(p.baseCost, year, rate)
        }
      }
      return row
    })
  }, [overlay, rate])

  // 2. Cumulative S-curve across years.
  const cumulative = useMemo(() => {
    let running = 0
    return YEARS.map((year) => {
      const yearTotal = PROJECTS.reduce(
        (s, p) =>
          effectiveYear(p, overlay) === year ? s + escalatedCost(p.baseCost, year, rate) : s,
        0,
      )
      running += yearTotal
      return { year: String(year), cumulative: running }
    })
  }, [overlay, rate])

  const grandTotal = cumulative.length ? cumulative[cumulative.length - 1].cumulative : 0

  // 3. Spend by group across the whole program, sorted descending.
  const byGroup = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const g of GROUPS) totals[g] = 0
    for (const p of PROJECTS) {
      totals[p.group] += escalatedCost(p.baseCost, effectiveYear(p, overlay), rate)
    }
    return GROUPS.map((g) => ({ group: g, name: GROUP_NAME[g], value: totals[g] })).sort(
      (a, b) => b.value - a.value,
    )
  }, [overlay, rate])

  // 4. Offseason vs Year-Round per year.
  const bySeason = useMemo(() => {
    return YEARS.map((year) => {
      let offseason = 0
      let yearRound = 0
      for (const p of PROJECTS) {
        if (effectiveYear(p, overlay) !== year) continue
        const c = escalatedCost(p.baseCost, year, rate)
        if (isYearRound(p)) yearRound += c
        else offseason += c
      }
      return { year: String(year), Offseason: offseason, 'Year-Round': yearRound }
    })
  }, [overlay, rate])

  return (
    <main className="flex-1 overflow-y-auto bg-pcl-lightgray/20 p-4">
      {/* Chart 1 — primary, full width */}
      <ChartCard
        title="Spend per Year by Group"
        subtitle="Total escalated spend per year, stacked by program group"
        className="mb-4"
      >
        <ResponsiveContainer width="100%" height={420}>
          <BarChart data={byYearGroup} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-pcl-lightgray)" />
            <XAxis dataKey="year" tick={{ fill: DARK, fontSize: 13 }} stroke={MID} />
            <YAxis tickFormatter={axisM} tick={{ fill: DARK, fontSize: 12 }} stroke={MID} width={70} />
            <Tooltip content={<GroupTooltip />} cursor={{ fill: 'var(--color-pcl-yellow)', opacity: 0.12 }} />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'Barlow' }} />
            {GROUPS.map((g) => (
              <Bar
                key={g}
                dataKey={g}
                name={GROUP_NAME[g]}
                stackId="spend"
                fill={colorForGroup(g).border}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Charts 2–4 — responsive grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* 2. Cumulative S-curve */}
        <ChartCard
          title="Cumulative Spend (S-Curve)"
          subtitle={`Running escalated total · program ${fmtM(grandTotal)}`}
        >
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={cumulative} margin={{ top: 16, right: 48, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="scurve" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-pcl-lightgray)" />
              <XAxis dataKey="year" tick={{ fill: DARK, fontSize: 13 }} stroke={MID} />
              <YAxis tickFormatter={axisM} tick={{ fill: DARK, fontSize: 12 }} stroke={MID} width={64} />
              <Tooltip content={<ValueTooltip />} />
              <Area
                type="monotone"
                dataKey="cumulative"
                name="Cumulative"
                stroke={GREEN}
                strokeWidth={2.5}
                fill="url(#scurve)"
                dot={{ r: 3, fill: GREEN }}
              >
                <LabelList dataKey="cumulative" content={<FinalLabel /> as any} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 3. Spend by group, full program */}
        <ChartCard title="Spend by Group — Full Program" subtitle="Total escalated cost, all years">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={byGroup}
              layout="vertical"
              margin={{ top: 4, right: 56, bottom: 0, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-pcl-lightgray)" horizontal={false} />
              <XAxis type="number" tickFormatter={axisM} tick={{ fill: DARK, fontSize: 11 }} stroke={MID} />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fill: DARK, fontSize: 11 }}
                stroke={MID}
              />
              <Tooltip content={<ValueTooltip />} cursor={{ fill: 'var(--color-pcl-yellow)', opacity: 0.12 }} />
              <Bar dataKey="value" name="Group total">
                {byGroup.map((d) => (
                  <Cell key={d.group} fill={colorForGroup(d.group).border} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(v: any) => fmtM(Number(v))}
                  style={{ fill: DARK, fontFamily: 'Barlow Condensed', fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 4. Offseason vs Year-Round */}
        <ChartCard
          title="Offseason vs. Year-Round"
          subtitle="Season-disruption risk per year (Year-Round in red)"
        >
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={bySeason} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-pcl-lightgray)" />
              <XAxis dataKey="year" tick={{ fill: DARK, fontSize: 13 }} stroke={MID} />
              <YAxis tickFormatter={axisM} tick={{ fill: DARK, fontSize: 12 }} stroke={MID} width={64} />
              <Tooltip content={<ValueTooltip />} cursor={{ fill: 'var(--color-pcl-yellow)', opacity: 0.12 }} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'Barlow' }} />
              <Bar dataKey="Offseason" stackId="season" fill={GREEN} />
              <Bar dataKey="Year-Round" stackId="season" fill={ORANGE} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </main>
  )
}

// Renders the grand-total label on the final S-curve point only.
function FinalLabel(props: any) {
  const { x, y, value, index } = props
  if (index !== YEARS.length - 1) return null
  return (
    <text
      x={x}
      y={y - 12}
      textAnchor="end"
      fontFamily="Barlow Condensed"
      fontWeight={700}
      fontSize={16}
      fill="var(--color-pcl-green)"
    >
      {fmtM(value)}
    </text>
  )
}
