import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { PROJECTS, YEARS, DEFAULT_ESCALATION, type Project } from './data/chaseFieldProjects'
import { colorForGroup } from './groupColors'
import {
  MIN_YEAR,
  escalatedCost,
  effectiveYear,
  effectiveTiming,
  sourceTiming,
  seedTiming,
  isIncluded,
  fmtM,
  type Overlay,
  type EffectiveTiming,
  type TimingOverlay,
  type Exclusions,
} from './phasing'
import Analytics from './Analytics'
import Resources from './Resources'
import PrintLayout from './PrintLayout'
import pclLogo from './assets/pcl-logo.png'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

// Co-branding flag: show the JLL partner logo chip alongside the client mark.
// Wired but OFF by default — flip to true once the JLL relationship is confirmed.
const SHOW_PARTNER_LOGO = false

// Fixed-aspect white chip that holds a third-party logo. The white background lets
// a colored mark read cleanly against the dark green header. Pass `src` to render
// the actual logo (object-contain, no distortion); without it, a labeled placeholder
// shows — used by slots whose asset isn't wired yet (e.g. JLL).
function LogoChip({ label, src, className = '' }: { label: string; src?: string; className?: string }) {
  return (
    <div
      className={
        'flex items-center justify-center rounded-md border border-pcl-lightgray/60 bg-white p-1.5 shadow-sm ' +
        className
      }
    >
      {src ? (
        <img src={src} alt={label} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-pcl-midgray/50 text-[10px] font-semibold uppercase tracking-wider text-pcl-midgray">
          {label}
        </div>
      )}
    </div>
  )
}

// Signed compact millions with a real minus glyph: -4_100_000 -> "−$4.1M".
function fmtMSigned(n: number): string {
  const sign = n < 0 ? '−' : '+'
  return `${sign}$${Math.abs(n / 1_000_000).toFixed(1)}M`
}

// Below this (rounds to $0.0M) a column reads as "on baseline".
const NEUTRAL_BAND = 50_000

// View-only state (never touches placement, totals, or drag).
type Density = 'detailed' | 'compact'

// Filter dimension: project group — one entry per [letter, name], matching the
// group badges shown on the cards. Sorted by group letter.
const GROUPS: Array<[string, string]> = Array.from(
  new Map(PROJECTS.map((p) => [p.group, p.groupName])).entries(),
).sort(([a], [b]) => a.localeCompare(b))

// Display metadata per timing state: green Offseason, red Year-Round, gray Unknown.
const TIMING_META: Record<EffectiveTiming, { label: string; short: string; color: string }> = {
  offseason: { label: 'Offseason', short: 'Off', color: '#00502f' }, // pcl-green
  yearround: { label: 'Year-Round', short: 'Year', color: '#d83c31' }, // pcl-orange
  unknown: { label: 'Unknown', short: '?', color: '#a6a6a6' }, // pcl-midgray
}

// Timing flag on a card. Interactive (a button) when onToggle is given; otherwise
// a static span (drag overlay / preview). Dot-only in compact, dot + label detailed.
function TimingBadge({
  timing,
  onToggle,
  compact = false,
}: {
  timing: EffectiveTiming
  onToggle?: () => void
  compact?: boolean
}) {
  const meta = TIMING_META[timing]
  const interactive = !!onToggle
  const title = `Timing: ${meta.label}${interactive ? ' — click to change' : ''}`

  // Keep clicks/drags on the badge from starting a card drag.
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation()
  const handlers = interactive
    ? {
        onPointerDown: stop,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation()
          onToggle!()
        },
      }
    : {}

  const dot = (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: meta.color }}
    />
  )

  if (compact) {
    return (
      <button
        type="button"
        {...handlers}
        title={title}
        aria-label={title}
        className={
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full ' +
          (interactive ? 'cursor-pointer hover:ring-2 hover:ring-pcl-yellow' : '')
        }
      >
        {dot}
      </button>
    )
  }

  return (
    <button
      type="button"
      {...handlers}
      title={title}
      aria-label={title}
      style={{ color: meta.color }}
      className={
        'flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
        (interactive ? 'cursor-pointer hover:ring-2 hover:ring-pcl-yellow' : '')
      }
    >
      {dot}
      {meta.short}
    </button>
  )
}

// Include/exclude checkbox. Checked (green ✓) = in scope; empty = excluded.
// Static span when no handler (drag overlay). Same 16px box in both densities.
function ExcludeToggle({
  excluded,
  onToggle,
}: {
  excluded: boolean
  onToggle?: () => void
}) {
  const interactive = !!onToggle
  const title = excluded
    ? 'Excluded from scope — click to include'
    : 'Included in scope — click to exclude'

  // Don't let clicks/drags on the control start a card drag.
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation()
  const handlers = interactive
    ? {
        onPointerDown: stop,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation()
          onToggle!()
        },
      }
    : {}

  return (
    <button
      type="button"
      {...handlers}
      title={title}
      aria-label={title}
      aria-pressed={!excluded}
      className={
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold leading-none ' +
        (excluded
          ? 'border-pcl-midgray bg-white text-transparent'
          : 'border-pcl-green bg-pcl-green text-white') +
        (interactive ? ' cursor-pointer hover:ring-2 hover:ring-pcl-yellow' : '')
      }
    >
      ✓
    </button>
  )
}

// Compact labeled switch for the header. Display-only — flips a boolean.
function HeaderSwitch({
  label,
  on,
  onToggle,
}: {
  label: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-sans text-xs font-medium uppercase tracking-wide text-white/70">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={
          'relative h-5 w-9 shrink-0 rounded-full transition-colors ' +
          (on ? 'bg-pcl-yellow' : 'bg-white/20')
        }
      >
        <span
          className={
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ' +
            (on ? 'left-[18px]' : 'left-0.5')
          }
        />
      </button>
    </div>
  )
}

function ProjectCard({
  project,
  cost,
  timing,
  onToggleTiming,
  excluded = false,
  onToggleExclude,
  showScope = false,
  showSeason = false,
  dragging = false,
  compact = false,
}: {
  project: Project
  cost: number
  timing: EffectiveTiming
  onToggleTiming?: () => void
  excluded?: boolean
  onToggleExclude?: () => void
  showScope?: boolean
  showSeason?: boolean
  dragging?: boolean
  compact?: boolean
}) {
  const color = colorForGroup(project.group)
  // Excluded cards read as "removed": muted name/cost with a strikethrough.
  const struck = excluded ? 'line-through decoration-pcl-midgray/80 text-pcl-midgray' : ''

  // Compact: single row, group chip + truncated name + cost, ~1/3 the height.
  if (compact) {
    return (
      <div
        className={
          'flex items-center gap-2 rounded border-l-4 px-2 py-1 shadow-sm select-none ' +
          (dragging
            ? 'shadow-lg ring-2 ring-pcl-yellow cursor-grabbing'
            : excluded
              ? 'cursor-default'
              : 'cursor-grab')
        }
        style={{ backgroundColor: color.bg, borderLeftColor: color.border }}
      >
        <span
          className="flex h-4 w-5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white"
          style={{ backgroundColor: color.border }}
          title={`${project.group} · ${project.groupName}`}
        >
          {project.group}
        </span>
        {showSeason && <TimingBadge timing={timing} onToggle={onToggleTiming} compact />}
        {showScope && <ExcludeToggle excluded={excluded} onToggle={onToggleExclude} />}
        <span
          className={'min-w-0 flex-1 truncate font-sans text-xs font-medium text-pcl-darkgray ' + struck}
          title={`${project.name} — ${project.groupName}`}
        >
          {project.name}
        </span>
        {excluded && (
          <span className="shrink-0 rounded bg-pcl-midgray px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
            Excl
          </span>
        )}
        <span className={'shrink-0 font-condensed text-xs font-semibold tabular-nums text-pcl-darkgray ' + struck}>
          {usd.format(cost)}
        </span>
      </div>
    )
  }

  return (
    <div
      className={
        'rounded-md border-l-4 px-3 py-2 shadow-sm select-none ' +
        (dragging
          ? 'shadow-lg ring-2 ring-pcl-yellow cursor-grabbing'
          : excluded
            ? 'cursor-default'
            : 'cursor-grab')
      }
      style={{ backgroundColor: color.bg, borderLeftColor: color.border }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={'font-sans text-sm font-medium leading-snug text-pcl-darkgray ' + struck}>
          {project.name}
        </div>
        {/* Right cluster only renders when there's something to show, so the card
            reflows tight with no empty gap when controls are hidden. */}
        {(excluded || showScope) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {excluded && (
              <span className="rounded bg-pcl-midgray px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                Excluded
              </span>
            )}
            {showScope && <ExcludeToggle excluded={excluded} onToggle={onToggleExclude} />}
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="truncate rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: color.border }}
          >
            {project.group} · {project.groupName}
          </span>
          {showSeason && <TimingBadge timing={timing} onToggle={onToggleTiming} />}
        </div>
        <span className={'font-condensed text-base font-semibold tabular-nums text-pcl-darkgray ' + struck}>
          {usd.format(cost)}
        </span>
      </div>
    </div>
  )
}

function DraggableCard({
  project,
  cost,
  timing,
  onToggleTiming,
  excluded = false,
  onToggleExclude,
  showScope,
  showSeason,
  compact = false,
  dimmed = false,
}: {
  project: Project
  cost: number
  timing: EffectiveTiming
  onToggleTiming: () => void
  excluded?: boolean
  onToggleExclude: () => void
  showScope: boolean
  showSeason: boolean
  compact?: boolean
  dimmed?: boolean
}) {
  // Dimmed (filtered-out) and excluded cards are both non-draggable.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    disabled: dimmed || excluded,
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        // Dimmed: ~15% + non-interactive. Excluded: deactivated (~45%) but the
        // include toggle must stay clickable, so pointer events remain on.
        opacity: dimmed ? 0.15 : excluded ? 0.45 : isDragging ? 0 : 1,
        pointerEvents: dimmed ? 'none' : undefined,
        touchAction: 'none',
      }}
    >
      <ProjectCard
        project={project}
        cost={cost}
        timing={timing}
        onToggleTiming={onToggleTiming}
        excluded={excluded}
        onToggleExclude={onToggleExclude}
        showScope={showScope}
        showSeason={showSeason}
        compact={compact}
      />
    </div>
  )
}

function YearColumn({
  year,
  projects,
  overlay,
  rate,
  currentTotal,
  baselineTotal,
  density,
  filterActive,
  matches,
  timingOverlay,
  onToggleTiming,
  excluded,
  onToggleExclude,
  showScope,
  showSeason,
}: {
  year: number
  projects: Project[]
  overlay: Overlay
  rate: number
  currentTotal: number
  baselineTotal: number
  density: Density
  filterActive: boolean
  matches: (p: Project) => boolean
  timingOverlay: TimingOverlay
  onToggleTiming: (id: string) => void
  excluded: Exclusions
  onToggleExclude: (id: string) => void
  showScope: boolean
  showSeason: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `year-${year}` })

  const items = projects.filter((p) => effectiveYear(p, overlay) === year)
  const compact = density === 'compact'

  // Filtered subtotal: escalated cost of only the matching, INCLUDED cards.
  // View-only — does NOT affect currentTotal, which already excludes dropped items.
  const filteredSubtotal = filterActive
    ? items.reduce(
        (s, p) =>
          matches(p) && isIncluded(p, excluded) ? s + escalatedCost(p.baseCost, year, rate) : s,
        0,
      )
    : 0

  // Delta vs. the project's default-year placement (both escalated at the current rate).
  const delta = currentTotal - baselineTotal
  const onBaseline = Math.abs(delta) < NEUTRAL_BAND

  return (
    <div className="flex min-w-[260px] flex-1 flex-col rounded-lg bg-pcl-lightgray/40">
      <div className="sticky top-0 z-10 rounded-t-lg border-b-2 border-pcl-yellow bg-pcl-lightgray px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="font-condensed text-2xl font-bold leading-none text-pcl-darkgray">
            {year}
          </span>
          <span className="font-condensed text-xs font-medium uppercase tracking-wide text-pcl-midgray">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {/* Current total */}
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-condensed text-lg font-semibold tabular-nums text-pcl-green">
            {usd.format(currentTotal)}
          </span>
        </div>

        {/* Filtered subtotal — only the matching cards; shown only while a filter is active */}
        {filterActive && (
          <div className="font-condensed text-xs font-semibold tabular-nums text-pcl-indigo">
            Filtered: {fmtM(filteredSubtotal)}
          </div>
        )}

        {/* Delta vs. baseline */}
        <div
          className={
            'font-condensed text-xs font-medium tabular-nums ' +
            (onBaseline
              ? 'text-pcl-midgray'
              : delta > 0
                ? 'text-pcl-orange'
                : 'text-pcl-lightgreen')
          }
        >
          {onBaseline ? 'On baseline' : `${fmtMSigned(delta)} vs. baseline`}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={
          'flex flex-1 flex-col p-2 transition-colors ' +
          (compact ? 'gap-1 ' : 'gap-2 ') +
          (isOver ? 'bg-pcl-yellow/20 ring-2 ring-inset ring-pcl-yellow' : '')
        }
      >
        {items.map((p) => (
          <DraggableCard
            key={p.id}
            project={p}
            cost={escalatedCost(p.baseCost, year, rate)}
            timing={effectiveTiming(p, timingOverlay)}
            onToggleTiming={() => onToggleTiming(p.id)}
            excluded={!isIncluded(p, excluded)}
            onToggleExclude={() => onToggleExclude(p.id)}
            showScope={showScope}
            showSeason={showSeason}
            compact={compact}
            dimmed={filterActive && !matches(p)}
          />
        ))}
        {items.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-pcl-midgray">
            Drop projects here
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [overlay, setOverlay] = useState<Overlay>({})
  const [rate, setRate] = useState<number>(DEFAULT_ESCALATION)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Which top-level view is showing. Analytics & Resources derive read-only from state.
  const [view, setView] = useState<'phasing' | 'analytics' | 'resources'>('phasing')

  // View-only state — derived UI only, no effect on placement/totals/drag.
  const [density, setDensity] = useState<Density>('detailed')
  // Display-only card-control toggles, both OFF by default for a clean read.
  // These only control VISIBILITY of the per-card controls, never the overlays.
  const [showScope, setShowScope] = useState(false)
  const [showSeason, setShowSeason] = useState(false)
  const [activeGroups, setActiveGroups] = useState<string[]>([]) // empty => "All"
  const filterActive = activeGroups.length > 0
  const matches = (p: Project) => !filterActive || activeGroups.includes(p.group)

  function toggleGroup(g: string) {
    setActiveGroups((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    )
  }

  // Season-timing overlay — seeded from the source field, never mutates the data.
  // Toggling a card cycles its flag; Analytics reads this so the chart is live.
  const [timingOverlay, setTimingOverlay] = useState<TimingOverlay>(seedTiming)

  function toggleTiming(id: string) {
    setTimingOverlay((prev) => {
      // Cycle: unknown/offseason -> yearround -> offseason. Unknown lifts on first click.
      const cur = prev[id]
      const next = cur === 'yearround' ? 'offseason' : 'yearround'
      return { ...prev, [id]: next }
    })
  }

  // Scope-exclusion overlay — set of dropped projectIds. Default empty => all
  // included. No total or chart ever counts an excluded item.
  const [excluded, setExcluded] = useState<Exclusions>(() => new Set())

  function toggleExclude(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Small movement threshold so clicks/scroll aren't swallowed by drag activation.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const activeProject = activeId ? PROJECTS.find((p) => p.id === activeId) ?? null : null

  // All program totals count INCLUDED items only — excluded scope is never summed.
  const grandTotal = useMemo(
    () =>
      PROJECTS.reduce(
        (sum, p) =>
          isIncluded(p, excluded)
            ? sum + escalatedCost(p.baseCost, effectiveYear(p, overlay), rate)
            : sum,
        0,
      ),
    [overlay, rate, excluded],
  )

  const baselineTotal = useMemo(
    () =>
      PROJECTS.reduce((sum, p) => (isIncluded(p, excluded) ? sum + p.baseCost : sum), 0),
    [excluded],
  )

  // Deferred (excluded) scope, shown as a live readout near the grand total.
  const excludedSummary = useMemo(() => {
    let dollars = 0
    let count = 0
    for (const p of PROJECTS) {
      if (!isIncluded(p, excluded)) {
        dollars += p.baseCost
        count++
      }
    }
    return { dollars, count }
  }, [excluded])

  // Per-year live totals from the assigned-year overlay (escalated at current rate).
  const currentTotals = useMemo(() => {
    const m: Record<number, number> = {}
    for (const y of YEARS) m[y] = 0
    for (const p of PROJECTS) {
      if (!isIncluded(p, excluded)) continue
      const y = effectiveYear(p, overlay)
      if (m[y] === undefined) m[y] = 0
      m[y] += escalatedCost(p.baseCost, y, rate)
    }
    return m
  }, [overlay, rate, excluded])

  // Per-year baseline totals from each project's default-year placement (same rate).
  const baselineTotals = useMemo(() => {
    const m: Record<number, number> = {}
    for (const y of YEARS) m[y] = 0
    for (const p of PROJECTS) {
      if (!isIncluded(p, excluded)) continue
      const y = p.defaultYear ?? MIN_YEAR
      if (m[y] === undefined) m[y] = 0
      m[y] += escalatedCost(p.baseCost, y, rate)
    }
    return m
  }, [rate, excluded])

  const timingDirty = PROJECTS.some((p) => effectiveTiming(p, timingOverlay) !== sourceTiming(p))
  const isDirty =
    Object.keys(overlay).length > 0 ||
    rate !== DEFAULT_ESCALATION ||
    timingDirty ||
    excluded.size > 0

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    if (!overId.startsWith('year-')) return
    const targetYear = Number(overId.slice('year-'.length))
    const project = PROJECTS.find((p) => p.id === String(active.id))
    if (!project) return
    // Never mutate PROJECTS — only the overlay records the new assignment.
    setOverlay((prev) => {
      // If we're moving back to the project's own default year, drop the override entirely.
      if (targetYear === (project.defaultYear ?? MIN_YEAR)) {
        const next = { ...prev }
        delete next[project.id]
        return next
      }
      return { ...prev, [project.id]: targetYear }
    })
  }

  function resetToBaseline() {
    setOverlay({})
    setRate(DEFAULT_ESCALATION)
    setTimingOverlay(seedTiming())
    setExcluded(new Set())
  }

  const ratePct = (rate * 100).toFixed(1)

  return (
    <>
    {/* Interactive app — hidden when printing (the print layout takes over). */}
    <div className="flex h-screen flex-col bg-pcl-lightgray/20 text-pcl-darkgray print:hidden">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b-4 border-pcl-yellow bg-pcl-green px-6 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
        {/* PCL presenter mark — top-left, vertically centered. 75% of the prior
            h-28 (112px → 84px); w-auto + object-contain keeps it sharp. */}
        <img
          src={pclLogo}
          alt="PCL"
          className="h-[84px] w-auto shrink-0 object-contain pr-2"
        />
        <div className="mr-auto">
          <h1 className="font-condensed text-2xl font-bold uppercase leading-tight tracking-wide text-white">
            Chase Field — Capital Program Planner
          </h1>
          {/* yellow chevron accent under the title */}
          <div className="mt-1 h-1 w-24 bg-pcl-yellow" style={{ clipPath: 'polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%)' }} />
          {/* View tabs */}
          <div className="mt-3 inline-flex overflow-hidden rounded-md border border-white/30">
            {(['phasing', 'analytics', 'resources'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={
                  'px-4 py-1.5 font-condensed text-sm font-bold uppercase tracking-wide transition-colors ' +
                  (view === v
                    ? 'bg-pcl-yellow text-pcl-darkgray'
                    : 'bg-white/10 text-white hover:bg-white/20')
                }
              >
                {v === 'phasing' ? 'Phasing' : v === 'analytics' ? 'Analytics' : 'Resources'}
              </button>
            ))}
          </div>
        </div>

        {/* Client co-branding lockup removed — the title block now breathes into
            this space. JLL partner mark stays wired but gated (off by default). */}
        {SHOW_PARTNER_LOGO && (
          <div className="flex items-center gap-3">
            <LogoChip label="JLL" className="h-12 w-24" />
          </div>
        )}

        {/* Global controls: escalation input + action buttons, bottom-aligned so the
            input box and the button group share one baseline. */}
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1 font-sans text-xs font-medium text-white/90">
            Escalation / yr
            <div className="flex h-9 items-center rounded border border-white/30 bg-white">
              <input
                type="number"
                step={0.1}
                min={0}
                max={100}
                value={ratePct}
                onChange={(e) => setRate(Math.max(0, Number(e.target.value) / 100))}
                className="w-20 rounded-l px-2 text-right font-condensed tabular-nums text-pcl-darkgray outline-none focus:bg-pcl-yellow/30"
              />
              <span className="px-2 text-pcl-midgray">%</span>
            </div>
          </label>

          {/* Action button group — consistent height, padding, and spacing. */}
          <div className="flex items-center gap-2">
            {/* Export the current (edited) state to PDF via the browser print dialog. */}
            <button
              onClick={() => window.print()}
              title="Open the print dialog — choose “Save as PDF”"
              className="flex h-9 items-center rounded border border-white/20 bg-pcl-yellow px-3 text-sm font-semibold text-pcl-darkgray transition-colors hover:bg-white"
            >
              Export PDF
            </button>
            {view === 'phasing' && (
              <button
                onClick={resetToBaseline}
                disabled={!isDirty}
                className="flex h-9 items-center rounded border border-white/20 bg-pcl-green px-3 text-sm font-semibold text-white transition-colors hover:bg-pcl-yellow hover:text-pcl-darkgray disabled:cursor-not-allowed disabled:border-transparent disabled:bg-pcl-midgray/40 disabled:text-white/70 disabled:hover:bg-pcl-midgray/40 disabled:hover:text-white/70"
              >
                Reset to baseline
              </button>
            )}
          </div>
        </div>
        </div>

        {/* View-only controls strip: density toggle + type filter (Phasing only) */}
        {view === 'phasing' && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/15 pt-2">
          {/* Density toggle */}
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-medium uppercase tracking-wide text-white/70">
              Density
            </span>
            <div className="flex overflow-hidden rounded border border-white/30">
              {(['detailed', 'compact'] as Density[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDensity(d)}
                  className={
                    'px-3 py-1 font-sans text-xs font-semibold capitalize transition-colors ' +
                    (density === d
                      ? 'bg-pcl-yellow text-pcl-darkgray'
                      : 'bg-white/10 text-white hover:bg-white/20')
                  }
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Card-control display toggles (display only; overlays persist). */}
          <HeaderSwitch label="Scope toggles" on={showScope} onToggle={() => setShowScope((v) => !v)} />
          <HeaderSwitch label="Season flags" on={showSeason} onToggle={() => setShowSeason((v) => !v)} />

          {/* Group filter (multi-select; does not remove cards or change totals).
              One button per project group, colored to match the card group badges. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-sans text-xs font-medium uppercase tracking-wide text-white/70">
              Filter
            </span>
            <button
              onClick={() => setActiveGroups([])}
              className={
                'rounded px-2.5 py-1 font-condensed text-xs font-semibold uppercase tracking-wide transition-colors ' +
                (!filterActive
                  ? 'bg-pcl-yellow text-pcl-darkgray'
                  : 'bg-white/10 text-white hover:bg-white/20')
              }
            >
              All
            </button>
            {GROUPS.map(([g, name]) => {
              const on = activeGroups.includes(g)
              const color = colorForGroup(g)
              return (
                <button
                  key={g}
                  onClick={() => toggleGroup(g)}
                  title={`${g} · ${name}`}
                  style={{
                    backgroundColor: color.bg,
                    borderColor: color.border,
                    opacity: on || !filterActive ? 1 : 0.55,
                  }}
                  className={
                    'flex items-center gap-1.5 rounded border-2 px-2 py-1 font-condensed text-xs font-semibold text-pcl-darkgray transition-all ' +
                    (on ? 'ring-2 ring-pcl-yellow' : 'hover:opacity-100')
                  }
                >
                  <span
                    className="flex h-4 w-5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white"
                    style={{ backgroundColor: color.border }}
                  >
                    {g}
                  </span>
                  <span className="max-w-[7rem] truncate">{name}</span>
                </button>
              )
            })}
            {filterActive && (
              <button
                onClick={() => setActiveGroups([])}
                className="ml-1 font-sans text-[11px] font-medium text-white/80 underline decoration-dotted underline-offset-2 hover:text-pcl-yellow"
              >
                Clear filter
              </button>
            )}
          </div>
        </div>
        )}
      </header>

      {view === 'phasing' ? (
        <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {/* Columns — main is the scroll container (definite height); the inner row
            has auto height + min-h-full so the single flex line grows to the tallest
            column's content. This keeps every column's grey panel extended to its last
            card while still matching all columns to the tallest. */}
        <main className="flex-1 overflow-auto p-4">
          <div className="flex min-h-full gap-3">
          {YEARS.map((year) => (
            <YearColumn
              key={year}
              year={year}
              projects={PROJECTS}
              overlay={overlay}
              rate={rate}
              currentTotal={currentTotals[year] ?? 0}
              baselineTotal={baselineTotals[year] ?? 0}
              density={density}
              filterActive={filterActive}
              matches={matches}
              timingOverlay={timingOverlay}
              onToggleTiming={toggleTiming}
              excluded={excluded}
              onToggleExclude={toggleExclude}
              showScope={showScope}
              showSeason={showSeason}
            />
          ))}
          </div>
        </main>

        <DragOverlay dropAnimation={null}>
          {activeProject ? (
            <div className="w-[244px]">
              <ProjectCard
                project={activeProject}
                cost={escalatedCost(
                  activeProject.baseCost,
                  effectiveYear(activeProject, overlay),
                  rate,
                )}
                timing={effectiveTiming(activeProject, timingOverlay)}
                excluded={!isIncluded(activeProject, excluded)}
                showScope={showScope}
                showSeason={showSeason}
                dragging
                compact={density === 'compact'}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Grand-total bar */}
      <footer className="flex flex-wrap items-center gap-x-8 gap-y-1 border-t-4 border-pcl-yellow bg-pcl-green px-6 py-3 shadow-[0_-1px_3px_rgba(0,0,0,0.15)]">
        <div className="flex items-baseline gap-2">
          <span className="font-condensed text-xs font-semibold uppercase tracking-wide text-white/70">
            Grand total (escalated)
          </span>
          <span className="font-condensed text-2xl font-bold tabular-nums text-pcl-yellow">
            {usd.format(grandTotal)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-condensed text-xs font-semibold uppercase tracking-wide text-white/60">
            Baseline (un-escalated)
          </span>
          <span className="font-condensed text-base font-medium tabular-nums text-white/90">
            {usd.format(baselineTotal)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-condensed text-xs font-semibold uppercase tracking-wide text-white/60">
            Escalation premium
          </span>
          <span className="font-condensed text-base font-medium tabular-nums text-pcl-yellow">
            +{usd.format(grandTotal - baselineTotal)}
          </span>
        </div>

        {/* Deferred-scope readout — how much is currently dropped (un-escalated). */}
        <div className="flex items-baseline gap-2">
          <span className="font-condensed text-xs font-semibold uppercase tracking-wide text-white/60">
            Excluded
          </span>
          <span
            className={
              'font-condensed text-base font-medium tabular-nums ' +
              (excludedSummary.count > 0 ? 'text-pcl-orange' : 'text-white/60')
            }
          >
            {usd.format(excludedSummary.dollars)}
            <span className="ml-1 text-xs font-normal text-white/60">
              (un-escalated) · {excludedSummary.count}{' '}
              {excludedSummary.count === 1 ? 'item' : 'items'}
            </span>
          </span>
        </div>

        <span className="ml-auto font-sans text-xs text-white/70">
          {PROJECTS.length - excludedSummary.count} of {PROJECTS.length} included ·{' '}
          {YEARS[0]}–{YEARS[YEARS.length - 1]} · {ratePct}% / yr
        </span>
      </footer>
        </>
      ) : view === 'analytics' ? (
        <Analytics overlay={overlay} rate={rate} timingOverlay={timingOverlay} excluded={excluded} />
      ) : (
        <Resources overlay={overlay} rate={rate} timingOverlay={timingOverlay} excluded={excluded} />
      )}
    </div>

    {/* Dedicated print layout — derived from current state, visible only in print. */}
    <PrintLayout overlay={overlay} rate={rate} timingOverlay={timingOverlay} excluded={excluded} />
    </>
  )
}
