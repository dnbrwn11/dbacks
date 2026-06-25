import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Cell,
} from 'recharts'
import pclLogo from './assets/pcl-logo.png'
import { PROJECTS, YEARS } from './data/chaseFieldProjects'
import {
  effectiveYear,
  escalatedCost,
  effectiveTiming,
  isIncluded,
  fmtM,
  type Overlay,
  type TimingOverlay,
  type Exclusions,
  type EffectiveTiming,
} from './phasing'
import { colorForGroup } from './groupColors'

// Print-safe literal colors (no CSS vars, so print-color-adjust renders them).
const GREEN = '#00502f'
const ORANGE = '#d83c31'
const MID = '#a6a6a6'
const INK = '#000000'

// Stable group ordering + name lookup, derived from the existing data.
const GROUPS = Array.from(new Set(PROJECTS.map((p) => p.group))).sort()
const GROUP_NAME: Record<string, string> = {}
for (const p of PROJECTS) GROUP_NAME[p.group] = p.groupName

const TIMING_LABEL: Record<EffectiveTiming, string> = {
  offseason: 'Offseason',
  yearround: 'Year-Round',
  unknown: 'Unknown',
}

const axisM = (v: number) => `$${Math.round(v / 1_000_000)}M`

// Small group color swatch for table rows (a chip, not a full-bleed fill).
function Swatch({ group }: { group: string }) {
  return (
    <span
      className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] align-middle"
      style={{ backgroundColor: colorForGroup(group).border }}
    />
  )
}

export default function PrintLayout({
  overlay,
  rate,
  timingOverlay,
  excluded,
}: {
  overlay: Overlay
  rate: number
  timingOverlay: TimingOverlay
  excluded: Exclusions
}) {
  // Everything below is PURELY DERIVED from current state (placement, exclusion,
  // timing, escalation). No new source of truth.
  const model = useMemo(() => {
    const included = PROJECTS.filter((p) => isIncluded(p, excluded))
    const excludedItems = PROJECTS.filter((p) => !isIncluded(p, excluded))

    // Summary matrix: group x year -> escalated spend (included only).
    const matrix: Record<string, Record<number, number>> = {}
    for (const g of GROUPS) {
      matrix[g] = {}
      for (const y of YEARS) matrix[g][y] = 0
    }
    for (const p of included) {
      const y = effectiveYear(p, overlay)
      if (matrix[p.group]?.[y] === undefined) continue
      matrix[p.group][y] += escalatedCost(p.baseCost, y, rate)
    }
    const groupTotal: Record<string, number> = {}
    for (const g of GROUPS) groupTotal[g] = YEARS.reduce((s, y) => s + matrix[g][y], 0)
    const yearTotal: Record<number, number> = {}
    for (const y of YEARS) yearTotal[y] = GROUPS.reduce((s, g) => s + matrix[g][y], 0)

    const grandTotal = included.reduce(
      (s, p) => s + escalatedCost(p.baseCost, effectiveYear(p, overlay), rate),
      0,
    )
    const baselineTotal = included.reduce((s, p) => s + p.baseCost, 0)
    const excludedTotal = excludedItems.reduce((s, p) => s + p.baseCost, 0)

    // Detail: included items grouped by year (sorted by escalated cost desc).
    const byYear = YEARS.map((year) => {
      const items = included
        .filter((p) => effectiveYear(p, overlay) === year)
        .map((p) => ({ p, cost: escalatedCost(p.baseCost, year, rate) }))
        .sort((a, b) => b.cost - a.cost)
      const subtotal = items.reduce((s, it) => s + it.cost, 0)
      return { year, items, subtotal }
    })

    // Chart data (mirrors the on-screen Analytics, included only).
    const byYearGroup = YEARS.map((year) => {
      const row: Record<string, number | string> = { year: String(year) }
      for (const g of GROUPS) row[g] = matrix[g][year]
      return row
    })
    let running = 0
    const cumulative = YEARS.map((year) => {
      running += yearTotal[year]
      return { year: String(year), cumulative: running }
    })
    const byGroup = GROUPS.map((g) => ({ group: g, name: GROUP_NAME[g], value: groupTotal[g] })).sort(
      (a, b) => b.value - a.value,
    )
    const bySeason = YEARS.map((year) => {
      let offseason = 0
      let yearRound = 0
      let unknown = 0
      for (const p of included) {
        if (effectiveYear(p, overlay) !== year) continue
        const c = escalatedCost(p.baseCost, year, rate)
        const t = effectiveTiming(p, timingOverlay)
        if (t === 'yearround') yearRound += c
        else if (t === 'offseason') offseason += c
        else unknown += c
      }
      return { year: String(year), Offseason: offseason, 'Year-Round': yearRound, Unknown: unknown }
    })

    return {
      matrix,
      groupTotal,
      yearTotal,
      grandTotal,
      baselineTotal,
      excludedTotal,
      excludedItems,
      byYear,
      byYearGroup,
      cumulative,
      byGroup,
      bySeason,
    }
  }, [overlay, rate, timingOverlay, excluded])

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const ratePct = (rate * 100).toFixed(1)
  const premium = model.grandTotal - model.baselineTotal

  const th = 'border border-black/40 px-2 py-1 text-left font-semibold'
  const thNum = 'border border-black/40 px-2 py-1 text-right font-semibold'
  const td = 'border border-black/30 px-2 py-1 text-left align-top'
  const tdNum = 'border border-black/30 px-2 py-1 text-right tabular-nums align-top'

  return (
    <div className="print-root hidden bg-white text-black print:block">
      {/* ============================= PAGE 1 — COVER ============================= */}
      <section className="print-section">
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <h1 className="font-condensed text-3xl font-bold uppercase tracking-wide">
              Chase Field — Capital Program Planner
            </h1>
            <p className="mt-1 font-condensed text-lg">Prepared for Arizona Diamondbacks</p>
            <p className="mt-0.5 text-sm">{today}</p>
          </div>
          <img src={pclLogo} alt="PCL" className="h-20 w-auto object-contain" />
        </div>

        {/* Program totals */}
        <div className="mt-4 grid grid-cols-3 gap-x-8 gap-y-2 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-black/60">Grand total (escalated)</div>
            <div className="font-condensed text-2xl font-bold tabular-nums">{fmtM(model.grandTotal)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-black/60">Baseline (un-escalated)</div>
            <div className="font-condensed text-2xl font-bold tabular-nums">{fmtM(model.baselineTotal)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-black/60">Escalation premium</div>
            <div className="font-condensed text-2xl font-bold tabular-nums">+{fmtM(premium)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-black/60">Escalation rate</div>
            <div className="font-condensed text-2xl font-bold tabular-nums">{ratePct}% / yr</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-black/60">Excluded / deferred scope</div>
            <div className="font-condensed text-2xl font-bold tabular-nums">
              {fmtM(model.excludedTotal)}
              <span className="ml-1 text-sm font-normal">
                · {model.excludedItems.length}{' '}
                {model.excludedItems.length === 1 ? 'item' : 'items'} (un-escalated)
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-black/60">Included line items</div>
            <div className="font-condensed text-2xl font-bold tabular-nums">
              {PROJECTS.length - model.excludedItems.length} of {PROJECTS.length}
            </div>
          </div>
        </div>

        {/* Summary table — group x year (escalated), with year & group totals */}
        <h2 className="mt-6 font-condensed text-lg font-bold uppercase tracking-wide">
          Escalated Spend by Group &amp; Year
        </h2>
        <table className="mt-2 w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className={th}>Program group</th>
              {YEARS.map((y) => (
                <th key={y} className={thNum}>
                  {y}
                </th>
              ))}
              <th className={thNum}>Group total</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <tr key={g}>
                <td className={td}>
                  <Swatch group={g} />
                  {g} · {GROUP_NAME[g]}
                </td>
                {YEARS.map((y) => (
                  <td key={y} className={tdNum}>
                    {model.matrix[g][y] > 0 ? fmtM(model.matrix[g][y]) : '—'}
                  </td>
                ))}
                <td className={tdNum + ' font-semibold'}>{fmtM(model.groupTotal[g])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={td + ' font-bold'}>Year total</td>
              {YEARS.map((y) => (
                <td key={y} className={tdNum + ' font-bold'}>
                  {fmtM(model.yearTotal[y])}
                </td>
              ))}
              <td className={tdNum + ' font-bold'}>{fmtM(model.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* ========================= PAGE 2+ — FULL DETAIL ========================= */}
      <section className="print-section break-before-page">
        <h2 className="font-condensed text-xl font-bold uppercase tracking-wide">
          Line-Item Detail by Year
        </h2>
        <p className="mb-3 text-xs text-black/60">
          All included scope at current placement, escalated at {ratePct}% / yr.
        </p>

        {model.byYear.map(({ year, items, subtotal }) =>
          items.length === 0 ? null : (
            <div key={year} className="mb-4">
              <h3 className="font-condensed text-base font-bold">
                {year} <span className="font-normal text-black/60">· {items.length} items</span>
              </h3>
              <table className="mt-1 w-full border-collapse text-[10px]">
                <thead>
                  <tr>
                    <th className={th + ' w-[46%]'}>Item</th>
                    <th className={th}>Group</th>
                    <th className={th}>Timing</th>
                    <th className={thNum}>Escalated cost</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(({ p, cost }) => (
                    <tr key={p.id}>
                      <td className={td}>{p.name}</td>
                      <td className={td}>
                        <Swatch group={p.group} />
                        {p.group} · {GROUP_NAME[p.group]}
                      </td>
                      <td className={td}>{TIMING_LABEL[effectiveTiming(p, timingOverlay)]}</td>
                      <td className={tdNum}>{fmtM(cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={td + ' font-bold'} colSpan={3}>
                      {year} subtotal
                    </td>
                    <td className={tdNum + ' font-bold'}>{fmtM(subtotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ),
        )}

        {/* Excluded / deferred scope */}
        {model.excludedItems.length > 0 && (
          <div className="mt-4 break-inside-avoid">
            <h3 className="font-condensed text-base font-bold uppercase tracking-wide">
              Excluded / Deferred Scope
            </h3>
            <p className="mb-1 text-xs text-black/60">
              Dropped from the program — shown at un-escalated baseline cost.
            </p>
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr>
                  <th className={th + ' w-[60%]'}>Item</th>
                  <th className={th}>Group</th>
                  <th className={thNum}>Un-escalated cost</th>
                </tr>
              </thead>
              <tbody>
                {model.excludedItems.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>{p.name}</td>
                    <td className={td}>
                      <Swatch group={p.group} />
                      {p.group} · {GROUP_NAME[p.group]}
                    </td>
                    <td className={tdNum}>{fmtM(p.baseCost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={td + ' font-bold'} colSpan={2}>
                    Total deferred
                  </td>
                  <td className={tdNum + ' font-bold'}>{fmtM(model.excludedTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* ========================= FINAL PAGES — ANALYTICS ========================= */}
      <section className="print-section break-before-page">
        <h2 className="mb-3 font-condensed text-xl font-bold uppercase tracking-wide">Analytics</h2>

        <div className="mb-6 break-inside-avoid">
          <h3 className="font-condensed text-base font-bold">Spend per Year by Group</h3>
          <BarChart width={920} height={360} data={model.byYearGroup} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
            <XAxis dataKey="year" tick={{ fill: INK, fontSize: 12 }} stroke={INK} />
            <YAxis tickFormatter={axisM} tick={{ fill: INK, fontSize: 11 }} stroke={INK} width={64} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {GROUPS.map((g) => (
              <Bar
                key={g}
                dataKey={g}
                name={GROUP_NAME[g]}
                stackId="spend"
                fill={colorForGroup(g).border}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </div>

        <div className="mb-6 break-inside-avoid">
          <h3 className="font-condensed text-base font-bold">Cumulative Spend (S-Curve)</h3>
          <AreaChart width={920} height={300} data={model.cumulative} margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
            <XAxis dataKey="year" tick={{ fill: INK, fontSize: 12 }} stroke={INK} />
            <YAxis tickFormatter={axisM} tick={{ fill: INK, fontSize: 11 }} stroke={INK} width={64} />
            <Area
              type="monotone"
              dataKey="cumulative"
              name="Cumulative"
              stroke={GREEN}
              strokeWidth={2.5}
              fill={GREEN}
              fillOpacity={0.15}
              dot={{ r: 3, fill: GREEN }}
              isAnimationActive={false}
            />
          </AreaChart>
        </div>

        <div className="mb-6 break-inside-avoid">
          <h3 className="font-condensed text-base font-bold">Spend by Group — Full Program</h3>
          <BarChart
            width={920}
            height={420}
            data={model.byGroup}
            layout="vertical"
            margin={{ top: 4, right: 56, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#ddd" horizontal={false} />
            <XAxis type="number" tickFormatter={axisM} tick={{ fill: INK, fontSize: 11 }} stroke={INK} />
            <YAxis type="category" dataKey="name" width={160} tick={{ fill: INK, fontSize: 10 }} stroke={INK} />
            <Bar dataKey="value" name="Group total" isAnimationActive={false}>
              {model.byGroup.map((d) => (
                <Cell key={d.group} fill={colorForGroup(d.group).border} />
              ))}
            </Bar>
          </BarChart>
        </div>

        <div className="mb-2 break-inside-avoid">
          <h3 className="font-condensed text-base font-bold">Offseason vs. Year-Round</h3>
          <BarChart width={920} height={300} data={model.bySeason} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
            <XAxis dataKey="year" tick={{ fill: INK, fontSize: 12 }} stroke={INK} />
            <YAxis tickFormatter={axisM} tick={{ fill: INK, fontSize: 11 }} stroke={INK} width={64} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Offseason" stackId="season" fill={GREEN} isAnimationActive={false} />
            <Bar dataKey="Year-Round" stackId="season" fill={ORANGE} isAnimationActive={false} />
            <Bar dataKey="Unknown" stackId="season" fill={MID} isAnimationActive={false} />
          </BarChart>
        </div>
      </section>
    </div>
  )
}
