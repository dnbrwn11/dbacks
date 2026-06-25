import { useMemo, useState } from 'react'
import { PROJECTS, YEARS } from './data/chaseFieldProjects'
import {
  effectiveYear,
  effectiveTiming,
  isIncluded,
  type Overlay,
  type TimingOverlay,
  type Exclusions,
} from './phasing'
import { colorForGroup } from './groupColors'

// Stable group ordering + name lookup, derived from the existing data.
const GROUPS = Array.from(new Set(PROJECTS.map((p) => p.group))).sort()
const GROUP_NAME: Record<string, string> = {}
for (const p of PROJECTS) GROUP_NAME[p.group] = p.groupName

// Default per-group labor fraction (share of stripped construction cost that is
// field labor). Building-systems trades carry more labor; fan/premium areas A–I
// default to a blended 0.35. All editable in the assumptions panel.
const DEFAULT_LABOR_FRACTION: Record<string, number> = {
  J: 0.5, // Structural Concrete
  N: 0.45, // Electrical
  O: 0.45, // Plumbing
  M: 0.35, // Mechanical
  K: 0.4, // Roof
  L: 0.4, // Telecom
  P: 0.3, // Security
  Q: 0.2, // AV & Broadcast
}
const seedLaborFractions = (): Record<string, number> => {
  const m: Record<string, number> = {}
  for (const g of GROUPS) m[g] = DEFAULT_LABOR_FRACTION[g] ?? 0.35
  return m
}

const round = (n: number) => Math.round(n)

// A labeled numeric assumption input. Holds a number; clearing reads as 0.
function Assumption({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  prefix,
  suffix,
  hint,
  width = 'w-20',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  prefix?: string
  suffix?: string
  hint?: string
  width?: string
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="font-sans text-[11px] font-medium leading-tight text-pcl-darkgray">{label}</span>
      <div className="flex items-center rounded border border-pcl-lightgray bg-white">
        {prefix && <span className="pl-1.5 text-xs text-pcl-midgray">{prefix}</span>}
        <input
          type="number"
          step={step}
          min={min}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={
            width +
            ' rounded px-2 py-1 text-right font-condensed tabular-nums text-pcl-darkgray outline-none focus:bg-pcl-yellow/20'
          }
        />
        {suffix && <span className="px-1.5 text-xs text-pcl-midgray">{suffix}</span>}
      </div>
      {hint && <span className="max-w-[11rem] font-sans text-[10px] leading-tight text-pcl-orange">{hint}</span>}
    </label>
  )
}

export default function Manpower({
  overlay,
  timingOverlay,
  excluded,
}: {
  overlay: Overlay
  timingOverlay: TimingOverlay
  excluded: Exclusions
}) {
  // Editable assumptions (placeholder defaults). Every driver is exposed.
  const [constructionFactor, setConstructionFactor] = useState(0.74)
  const [blendedRate, setBlendedRate] = useState(95)
  const [offWeeks, setOffWeeks] = useState(22)
  const [yrWeeks, setYrWeeks] = useState(48)
  const [hoursPerWeek, setHoursPerWeek] = useState(40)
  const [peakingFactor, setPeakingFactor] = useState(1.5)
  const [siteCapacity, setSiteCapacity] = useState(350)
  const [staffRatio, setStaffRatio] = useState(30)
  const [baseTeam, setBaseTeam] = useState(8)
  const [laborFractions, setLaborFractions] = useState<Record<string, number>>(seedLaborFractions)

  const rateValid = blendedRate > 0

  // Read-only derivation from existing state (assigned year, timing, exclusion) +
  // the editable assumptions. Excluded items contribute zero. Recomputes live.
  const { peakRaw, avgRaw, yearPeak, yearStaff, activeTrades } = useMemo(() => {
    const peakRaw: Record<string, Record<number, number>> = {}
    const avgRaw: Record<string, Record<number, number>> = {}
    for (const g of GROUPS) {
      peakRaw[g] = {}
      avgRaw[g] = {}
      for (const y of YEARS) {
        peakRaw[g][y] = 0
        avgRaw[g][y] = 0
      }
    }

    for (const p of PROJECTS) {
      if (!isIncluded(p, excluded)) continue // excluded items contribute zero
      const y = effectiveYear(p, overlay)
      if (peakRaw[p.group]?.[y] === undefined) continue

      // Strip loading -> labor $ -> labor hours.
      const constructionCost = p.baseCost * constructionFactor
      const laborFraction = laborFractions[p.group] ?? 0.35
      const laborDollars = constructionCost * laborFraction

      // Available hours depend on the season window: offseason vs year-round/unknown.
      const t = effectiveTiming(p, timingOverlay)
      const windowWeeks = t === 'offseason' ? offWeeks : yrWeeks
      const availableHours = windowWeeks * hoursPerWeek
      if (!rateValid || availableHours <= 0) continue

      const laborHours = laborDollars / blendedRate
      const avgCrew = laborHours / availableHours
      const peakCrew = avgCrew * peakingFactor

      avgRaw[p.group][y] += avgCrew
      peakRaw[p.group][y] += peakCrew
    }

    // Per-year site peak = sum of ROUNDED trade peaks (so the visible numbers add up).
    const yearPeak: Record<number, number> = {}
    const yearStaff: Record<number, number> = {}
    for (const y of YEARS) {
      let totalPeak = 0
      for (const g of GROUPS) totalPeak += round(peakRaw[g][y])
      yearPeak[y] = totalPeak
      const ratio = staffRatio > 0 ? staffRatio : 1
      yearStaff[y] = round(totalPeak / ratio + baseTeam)
    }

    const activeTrades = GROUPS.filter((g) => YEARS.some((y) => round(peakRaw[g][y]) > 0))

    return { peakRaw, avgRaw, yearPeak, yearStaff, activeTrades }
  }, [
    overlay,
    timingOverlay,
    excluded,
    constructionFactor,
    blendedRate,
    offWeeks,
    yrWeeks,
    hoursPerWeek,
    peakingFactor,
    staffRatio,
    baseTeam,
    laborFractions,
    rateValid,
  ])

  const gridCols = `200px repeat(${YEARS.length}, minmax(0, 1fr))`
  const anyOverCapacity = YEARS.some((y) => yearPeak[y] > siteCapacity)

  return (
    <div className="flex flex-col gap-4">
      {/* Required label / disclaimer */}
      <div className="rounded-lg border border-pcl-lightgray bg-white p-4 shadow-sm">
        <h2 className="font-condensed text-xl font-bold uppercase tracking-wide text-pcl-darkgray">
          Parametric Resource Estimate
        </h2>
        <p className="font-sans text-xs text-pcl-darkgray">
          Order-of-magnitude crew sizing derived from cost factors.{' '}
          <span className="font-semibold text-pcl-orange">Not a resource-loaded schedule.</span>
        </p>
        <p className="mt-1 font-sans text-[11px] italic text-pcl-midgray">
          Parametric estimate — not a CPM or resource-loaded schedule. Every number below is driven
          by the editable assumptions and rounded to whole people; treat as a planning signal, not a
          commitment.
        </p>
      </div>

      {/* Assumptions panel — prominent, every driver visible and editable */}
      <div className="rounded-lg border border-pcl-yellow/70 bg-pcl-lightgray/30 p-4 shadow-sm">
        <h3 className="mb-2 font-condensed text-sm font-bold uppercase tracking-wide text-pcl-darkgray">
          Assumptions <span className="font-normal text-pcl-midgray">(editable — drive every figure)</span>
        </h3>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <Assumption
            label="Construction factor"
            value={constructionFactor}
            onChange={setConstructionFactor}
            step={0.01}
            hint="strips GC / fee / contingency / soft"
          />
          <Assumption
            label="Blended craft rate"
            value={blendedRate}
            onChange={setBlendedRate}
            step={5}
            prefix="$"
            suffix="/hr"
            hint="set to your Phoenix composite"
          />
          <Assumption label="Peaking factor" value={peakingFactor} onChange={setPeakingFactor} step={0.1} />
          <Assumption label="Offseason window" value={offWeeks} onChange={setOffWeeks} suffix="wks" />
          <Assumption label="Year-round window" value={yrWeeks} onChange={setYrWeeks} suffix="wks" />
          <Assumption label="Hours / week" value={hoursPerWeek} onChange={setHoursPerWeek} suffix="hr" />
          <Assumption
            label="Site capacity (peak)"
            value={siteCapacity}
            onChange={setSiteCapacity}
            step={10}
            suffix="ppl"
            hint="years over this flag red"
          />
          <Assumption label="Craft per field staff" value={staffRatio} onChange={setStaffRatio} suffix=":1" />
          <Assumption label="Base team" value={baseTeam} onChange={setBaseTeam} suffix="ppl" />
        </div>

        {/* Per-trade labor fraction table */}
        <h4 className="mb-1.5 mt-4 font-condensed text-xs font-bold uppercase tracking-wide text-pcl-darkgray">
          Labor fraction by trade <span className="font-normal text-pcl-midgray">(share of stripped cost that is field labor)</span>
        </h4>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {GROUPS.map((g) => {
            const color = colorForGroup(g)
            return (
              <label key={g} className="flex items-center gap-1.5">
                <span
                  className="flex h-4 w-5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white"
                  style={{ backgroundColor: color.border }}
                  title={`${g} · ${GROUP_NAME[g]}`}
                >
                  {g}
                </span>
                <span className="max-w-[7rem] truncate font-sans text-[11px] text-pcl-darkgray" title={GROUP_NAME[g]}>
                  {GROUP_NAME[g]}
                </span>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={laborFractions[g]}
                  onChange={(e) =>
                    setLaborFractions((prev) => ({ ...prev, [g]: Number(e.target.value) }))
                  }
                  className="w-16 rounded border border-pcl-lightgray bg-white px-2 py-0.5 text-right font-condensed tabular-nums text-pcl-darkgray outline-none focus:bg-pcl-yellow/20"
                />
              </label>
            )
          })}
        </div>
      </div>

      {/* Results table */}
      <div className="rounded-lg border border-pcl-lightgray bg-white p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-condensed text-sm font-bold uppercase tracking-wide text-pcl-darkgray">
            Crew sizing by trade &amp; year
          </h3>
          <span className="font-sans text-[11px] text-pcl-midgray">
            Each cell: ~avg / ~peak craft · whole people only
          </span>
        </div>

        {!rateValid && (
          <div className="mb-2 rounded border border-pcl-orange bg-pcl-orange/10 px-2 py-1 font-sans text-[11px] text-pcl-orange">
            Set a blended craft rate above $0 to compute crew sizes.
          </div>
        )}

        {/* Year header */}
        <div className="grid items-end gap-1" style={{ gridTemplateColumns: gridCols }}>
          <div className="px-1 font-condensed text-xs font-semibold uppercase tracking-wide text-pcl-midgray">
            Trade / Year
          </div>
          {YEARS.map((y) => (
            <div key={y} className="px-1 text-center font-condensed text-lg font-bold leading-none text-pcl-darkgray">
              {y}
            </div>
          ))}
        </div>

        {/* Trade rows */}
        <div className="mt-1 flex flex-col gap-1">
          {activeTrades.length === 0 && (
            <div className="py-8 text-center font-sans text-xs text-pcl-midgray">
              No included scope to estimate. Re-include projects on the Phasing board.
            </div>
          )}
          {activeTrades.map((g) => {
            const color = colorForGroup(g)
            return (
              <div key={g} className="grid items-stretch gap-1" style={{ gridTemplateColumns: gridCols }}>
                <div className="flex min-w-0 items-center gap-1.5 px-1 py-1">
                  <span
                    className="flex h-5 w-6 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold text-white"
                    style={{ backgroundColor: color.border }}
                  >
                    {g}
                  </span>
                  <span className="truncate font-sans text-[11px] font-medium text-pcl-darkgray" title={GROUP_NAME[g]}>
                    {GROUP_NAME[g]}
                  </span>
                </div>
                {YEARS.map((y) => {
                  const avg = round(avgRaw[g][y])
                  const peak = round(peakRaw[g][y])
                  if (peak <= 0) {
                    return (
                      <div
                        key={y}
                        className="flex min-h-[38px] items-center justify-center rounded-md border border-dashed border-pcl-lightgray/70"
                      >
                        <span className="text-[10px] text-pcl-lightgray">·</span>
                      </div>
                    )
                  }
                  return (
                    <div
                      key={y}
                      title={`${GROUP_NAME[g]} ${y}: ~${avg} avg / ~${peak} peak craft`}
                      className="flex min-h-[38px] flex-col items-center justify-center rounded-md px-1 py-1"
                      style={{ backgroundColor: color.bg }}
                    >
                      <span className="font-condensed text-sm font-bold leading-none tabular-nums text-pcl-darkgray">
                        ~{avg} <span className="font-medium text-pcl-midgray">/</span> ~{peak}
                      </span>
                      <span className="font-sans text-[9px] uppercase tracking-wide text-pcl-midgray">
                        avg / peak
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Site peak craft — congestion / trade-stacking number, capacity-flagged */}
        <div
          className="mt-2 grid items-stretch gap-1 border-t-2 border-pcl-lightgray pt-2"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="flex flex-col justify-center px-1">
            <span className="font-condensed text-xs font-bold uppercase tracking-wide text-pcl-darkgray">
              Site peak craft
            </span>
            <span className="font-sans text-[10px] text-pcl-midgray">cap {siteCapacity} · sum of trade peaks</span>
          </div>
          {YEARS.map((y) => {
            const total = yearPeak[y]
            const over = total > siteCapacity
            return (
              <div
                key={y}
                title={
                  `${y}: ~${total} peak craft on site` +
                  (over ? ` — exceeds site capacity (${siteCapacity}): labor density risk` : '')
                }
                className={
                  'flex min-h-[40px] flex-col items-center justify-center gap-0.5 rounded-md ' +
                  (over ? 'bg-pcl-orange/15 ring-1 ring-inset ring-pcl-orange' : 'bg-pcl-lightgray/40')
                }
              >
                <span
                  className={
                    'font-condensed text-lg font-bold leading-none tabular-nums ' +
                    (over ? 'text-pcl-orange' : 'text-pcl-darkgray')
                  }
                >
                  ~{total}
                </span>
                {over && (
                  <span className="rounded bg-pcl-orange px-1 py-0.5 font-condensed text-[8px] font-bold uppercase tracking-wide text-white">
                    Labor density risk
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* PCL field staff readout */}
        <div className="mt-1 grid items-stretch gap-1" style={{ gridTemplateColumns: gridCols }}>
          <div className="flex flex-col justify-center px-1">
            <span className="font-condensed text-xs font-bold uppercase tracking-wide text-pcl-green">
              PCL field staff
            </span>
            <span className="font-sans text-[10px] text-pcl-midgray">peak craft ÷ {staffRatio} + {baseTeam} base</span>
          </div>
          {YEARS.map((y) => (
            <div
              key={y}
              title={`${y}: ~${yearStaff[y]} estimated PCL field staff`}
              className="flex min-h-[36px] items-center justify-center rounded-md bg-pcl-green/10"
            >
              <span className="font-condensed text-base font-bold leading-none tabular-nums text-pcl-green">
                ~{yearStaff[y]}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 font-sans text-[11px] italic text-pcl-midgray">
          {anyOverCapacity
            ? 'One or more years exceed the site-capacity threshold — shown in red as a labor-density risk. '
            : ''}
          Parametric estimate only — not a CPM or resource-loaded schedule. All headcounts rounded to
          whole people.
        </p>
      </div>
    </div>
  )
}
