import { useMemo, useState } from 'react'
import { PROJECTS, YEARS } from './data/chaseFieldProjects'
import Manpower from './Manpower'
import {
  effectiveYear,
  escalatedCost,
  effectiveTiming,
  isIncluded,
  fmtM,
  type Overlay,
  type TimingOverlay,
  type Exclusions,
} from './phasing'
import { colorForGroup } from './groupColors'

// Brand tokens (mirror the CSS variables from index.css).
const ORANGE = 'var(--color-pcl-orange)'
const MID = 'var(--color-pcl-midgray)'

// Stable group ordering + name lookup, derived from the existing data.
const GROUPS = Array.from(new Set(PROJECTS.map((p) => p.group))).sort()
const GROUP_NAME: Record<string, string> = {}
for (const p of PROJECTS) GROUP_NAME[p.group] = p.groupName

// Display-only CSI relabeling for the building-systems trades. Maps the source
// group letter to a division label for the ROW HEADER ONLY — source data and the
// group color map are untouched, and the underlying matrix is keyed by group.
const CSI_LABEL: Record<string, string> = {
  J: 'Div 03 — Concrete',
  K: 'Div 07 — Thermal & Moisture',
  O: 'Div 22 — Plumbing',
  M: 'Div 23 — HVAC',
  N: 'Div 26 — Electrical',
  L: 'Div 27 — Communications',
  Q: 'Div 27 — AV/Broadcast',
  P: 'Div 28 — Electronic Safety & Security',
}

// CSI rows grouped + ordered by division number; area rows keep their letter order.
const CSI_ORDER = ['J', 'K', 'O', 'M', 'N', 'L', 'Q', 'P']
const CSI_GROUPS = CSI_ORDER.filter((g) => GROUPS.includes(g))
const AREA_GROUPS = GROUPS.filter((g) => !CSI_LABEL[g])

// Row label: CSI division for building systems, area name otherwise.
const rowLabel = (g: string) => CSI_LABEL[g] ?? GROUP_NAME[g]

// Parse a #RRGGBB accent to [r, g, b].
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// Contrast-aware text. A cell's effective fill is the accent composited (alpha
// grows with intensity, matching the overlay below) over the light tint
// (accent 10% + white 90%). Bright fills get dark text; dark fills get white.
function darkTextForCell(accentHex: string, intensity: number): boolean {
  const [r, g, b] = hexToRgb(accentHex)
  const a = 0.18 + 0.62 * intensity // must match the intensity-fill opacity below
  const tint = (c: number) => c * 0.1 + 255 * 0.9
  const comp = (c: number) => c * a + tint(c) * (1 - a)
  const lum = 0.299 * comp(r) + 0.587 * comp(g) + 0.114 * comp(b)
  return lum > 150
}

// Diagonal orange hatch — overlaid on a cell that carries any Year-Round scope,
// signalling work that spills outside the safe offseason window.
const YEAR_ROUND_HATCH =
  'repeating-linear-gradient(45deg, rgba(216,60,49,0.55) 0 3px, transparent 3px 7px)'

// One group's spend in one year, split by season timing.
interface Cell {
  count: number
  value: number
  offseason: number
  yearround: number
  unknown: number
}

const emptyCell = (): Cell => ({ count: 0, value: 0, offseason: 0, yearround: 0, unknown: 0 })

export default function Resources({
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
  // Sub-view within the Resources tab: the trade timeline or the manpower estimate.
  const [subView, setSubView] = useState<'timeline' | 'manpower'>('timeline')

  // Read-only derivation from existing state only: assigned year, group, timing,
  // and exclusion. Excluded items never enter the timeline.
  const { matrix, groupPeak, congestion, maxCongestion } = useMemo(() => {
    // matrix[group][year] -> Cell
    const matrix: Record<string, Record<number, Cell>> = {}
    for (const g of GROUPS) {
      matrix[g] = {}
      for (const y of YEARS) matrix[g][y] = emptyCell()
    }

    for (const p of PROJECTS) {
      if (!isIncluded(p, excluded)) continue
      const y = effectiveYear(p, overlay)
      const cell = matrix[p.group]?.[y]
      if (!cell) continue
      const v = escalatedCost(p.baseCost, y, rate)
      cell.count += 1
      cell.value += v
      const t = effectiveTiming(p, timingOverlay)
      if (t === 'yearround') cell.yearround += v
      else if (t === 'offseason') cell.offseason += v
      else cell.unknown += v
    }

    // Per-group peak year value — drives band intensity within each row.
    const groupPeak: Record<string, number> = {}
    for (const g of GROUPS) {
      groupPeak[g] = Math.max(0, ...YEARS.map((y) => matrix[g][y].value))
    }

    // Congestion = distinct trades active in each year (how many groups stack).
    const congestion: Record<number, number> = {}
    for (const y of YEARS) {
      congestion[y] = GROUPS.reduce((n, g) => (matrix[g][y].count > 0 ? n + 1 : n), 0)
    }
    const maxCongestion = Math.max(1, ...YEARS.map((y) => congestion[y]))

    return { matrix, groupPeak, congestion, maxCongestion }
  }, [overlay, rate, timingOverlay, excluded])

  // Grid: a label column (wide enough for CSI division labels) + one column per year.
  const gridCols = `230px repeat(${YEARS.length}, minmax(0, 1fr))`

  // Render one trade/area row. Display-only: label comes from rowLabel(g), but all
  // values come from the group-keyed matrix, so re-phasing/exclusion still drives it.
  const renderRow = (g: string) => {
    const color = colorForGroup(g)
    const peak = groupPeak[g]
    const isArea = !CSI_LABEL[g]
    return (
      <div key={g} className="grid items-stretch gap-1" style={{ gridTemplateColumns: gridCols }}>
        {/* Row label */}
        <div className="flex min-w-0 items-center gap-1.5 px-1 py-1">
          <span
            className="flex h-5 w-6 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold text-white"
            style={{ backgroundColor: color.border }}
          >
            {g}
          </span>
          <span
            title={rowLabel(g)}
            className="truncate font-sans text-[11px] font-medium text-pcl-darkgray"
          >
            {rowLabel(g)}
          </span>
          {isArea && (
            <span
              title="Multi-trade area package — spans several CSI divisions"
              className="shrink-0 rounded-sm border border-pcl-midgray/50 bg-pcl-lightgray/40 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-pcl-midgray"
            >
              Multi
            </span>
          )}
        </div>

        {/* Year cells */}
        {YEARS.map((y) => {
          const cell = matrix[g][y]
          if (cell.count === 0) {
            return (
              <div
                key={y}
                className="flex min-h-[46px] items-center justify-center rounded-md border border-dashed border-pcl-lightgray/70"
              >
                <span className="text-[10px] text-pcl-lightgray">·</span>
              </div>
            )
          }

          // Intensity = this year's value vs. the group's peak year.
          const intensity = peak > 0 ? cell.value / peak : 0
          const hasYearRound = cell.yearround > 0
          // Contrast-aware text for this band's effective lightness.
          const dark = darkTextForCell(color.border, intensity)
          const textColor = dark ? '#36383D' : '#ffffff'
          const shadow = dark ? '' : 'drop-shadow-sm'
          // Timing split widths for the bottom strip.
          const off = (cell.offseason / cell.value) * 100
          const yr = (cell.yearround / cell.value) * 100
          const unk = (cell.unknown / cell.value) * 100
          const tip =
            `${rowLabel(g)} · ${y}\n` +
            `${cell.count} ${cell.count === 1 ? 'project' : 'projects'} · ${fmtM(cell.value)} (esc)\n` +
            `Offseason ${fmtM(cell.offseason)} · Year-Round ${fmtM(cell.yearround)} · Unknown ${fmtM(cell.unknown)}`

          return (
            <div
              key={y}
              title={tip}
              className={
                'relative flex min-h-[46px] flex-col justify-between overflow-hidden rounded-md ' +
                (hasYearRound ? 'ring-1 ring-inset ring-pcl-orange' : '')
              }
              style={{ backgroundColor: color.bg }}
            >
              {/* Intensity fill — group color scaled by share of the trade's scope */}
              <div
                className="absolute inset-0"
                style={{ backgroundColor: color.border, opacity: 0.18 + 0.62 * intensity }}
              />
              {/* Year-Round hatch overlay */}
              {hasYearRound && (
                <div className="absolute inset-0" style={{ backgroundImage: YEAR_ROUND_HATCH }} />
              )}
              {/* Count (primary) + dollar value (legible beneath) */}
              <div
                className="relative z-10 flex flex-1 flex-col items-center justify-center px-1 py-1"
                style={{ color: textColor }}
              >
                <span className={'font-condensed text-base font-bold leading-none ' + shadow}>
                  {cell.count}
                </span>
                <span className={'font-condensed text-xs font-bold leading-tight tabular-nums ' + shadow}>
                  {fmtM(cell.value)}
                </span>
              </div>
              {/* Timing-split strip — honest offseason/year-round/unknown mix */}
              <div className="relative z-10 flex h-1.5 w-full">
                {off > 0 && (
                  <div style={{ width: `${off}%`, backgroundColor: 'var(--color-pcl-green)' }} />
                )}
                {yr > 0 && <div style={{ width: `${yr}%`, backgroundColor: ORANGE }} />}
                {unk > 0 && <div style={{ width: `${unk}%`, backgroundColor: MID }} />}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <main className="flex-1 overflow-auto bg-pcl-lightgray/20 p-4">
      {/* Resources sub-view switcher */}
      <div className="mb-4 inline-flex overflow-hidden rounded-md border border-pcl-lightgray bg-white shadow-sm">
        {([
          ['timeline', 'Trade Timeline'],
          ['manpower', 'Manpower Estimate'],
        ] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setSubView(v)}
            className={
              'px-4 py-1.5 font-condensed text-sm font-bold uppercase tracking-wide transition-colors ' +
              (subView === v
                ? 'bg-pcl-green text-white'
                : 'bg-white text-pcl-darkgray hover:bg-pcl-lightgray/40')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {subView === 'manpower' ? (
        <Manpower overlay={overlay} timingOverlay={timingOverlay} excluded={excluded} />
      ) : (
      <div className="rounded-lg border border-pcl-lightgray bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-condensed text-xl font-bold uppercase tracking-wide text-pcl-darkgray">
              Trade Sequencing Timeline
            </h2>
            <p className="font-sans text-xs text-pcl-midgray">
              When each trade is active, and where work collides in the same year ·{' '}
              {YEARS[0]}–{YEARS[YEARS.length - 1]}
            </p>
            <p className="mt-0.5 font-sans text-[11px] italic text-pcl-midgray">
              Building systems shown by CSI division; premium program areas shown by area
              (multi-trade packages).
            </p>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-[11px] text-pcl-darkgray">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-4 rounded-sm bg-pcl-green/80" />
              Offseason (solid)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-3 w-4 rounded-sm ring-1 ring-inset ring-pcl-orange"
                style={{ backgroundImage: YEAR_ROUND_HATCH }}
              />
              Year-Round (hatched)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-4 rounded-sm" style={{ backgroundColor: MID, opacity: 0.5 }} />
              Unknown
            </span>
            <span className="text-pcl-midgray">Band intensity = share of that trade’s scope</span>
          </div>
        </div>

        {/* Year header */}
        <div className="grid items-end gap-1" style={{ gridTemplateColumns: gridCols }}>
          <div className="px-1 font-condensed text-xs font-semibold uppercase tracking-wide text-pcl-midgray">
            Trade / Year
          </div>
          {YEARS.map((y) => (
            <div
              key={y}
              className="px-1 text-center font-condensed text-lg font-bold leading-none text-pcl-darkgray"
            >
              {y}
            </div>
          ))}
        </div>

        {/* Congestion row — how many distinct trades stack in each year */}
        <div
          className="mt-1 grid items-stretch gap-1 border-b border-pcl-lightgray pb-2"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="flex items-center px-1 font-condensed text-[11px] font-semibold uppercase tracking-wide text-pcl-midgray">
            Congestion
          </div>
          {YEARS.map((y) => {
            const n = congestion[y]
            const share = n / maxCongestion
            const peak = n === maxCongestion && n > 0
            return (
              <div
                key={y}
                title={`${n} ${n === 1 ? 'trade' : 'trades'} active in ${y}`}
                className="flex flex-col items-center justify-end gap-1 px-1"
              >
                <span
                  className={
                    'font-condensed text-sm font-bold tabular-nums ' +
                    (peak ? 'text-pcl-orange' : 'text-pcl-darkgray')
                  }
                >
                  {n}
                </span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-pcl-lightgray/70">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round(share * 100)}%`,
                      backgroundColor: ORANGE,
                      opacity: 0.35 + 0.65 * share,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Rows, grouped into two categories with a subtle separator between them. */}
        <div className="mt-1 flex flex-col gap-1">
          {/* Building systems — CSI divisions (single-division trade rows) */}
          <div className="px-1 pt-1 font-condensed text-[11px] font-semibold uppercase tracking-wide text-pcl-midgray">
            Building Systems — CSI Divisions
          </div>
          {CSI_GROUPS.map(renderRow)}

          {/* Subtle separator + premium program areas (multi-trade package rows) */}
          <div className="mt-2 border-t border-pcl-lightgray px-1 pt-2 font-condensed text-[11px] font-semibold uppercase tracking-wide text-pcl-midgray">
            Premium Program Areas — Multi-Trade Packages
          </div>
          {AREA_GROUPS.map(renderRow)}
        </div>
      </div>
      )}
    </main>
  )
}
