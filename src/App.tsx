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
import { MIN_YEAR, escalatedCost, effectiveYear, fmtM, type Overlay } from './phasing'
import Analytics from './Analytics'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

// Signed compact millions with a real minus glyph: -4_100_000 -> "−$4.1M".
function fmtMSigned(n: number): string {
  const sign = n < 0 ? '−' : '+'
  return `${sign}$${Math.abs(n / 1_000_000).toFixed(1)}M`
}

// Below this (rounds to $0.0M) a column reads as "on baseline" / "on cap".
const NEUTRAL_BAND = 50_000

// View-only state (never touches placement, totals, or drag).
type Density = 'detailed' | 'compact'

// Type filter dimension. Null types collapse into an "Untyped" bucket.
const UNTYPED = 'Untyped'
const typeOf = (p: Project): string => p.type ?? UNTYPED
const TYPES: string[] = Array.from(new Set(PROJECTS.map(typeOf))).sort()

function ProjectCard({
  project,
  cost,
  dragging = false,
  compact = false,
}: {
  project: Project
  cost: number
  dragging?: boolean
  compact?: boolean
}) {
  const color = colorForGroup(project.group)

  // Compact: single row, group chip + truncated name + cost, ~1/3 the height.
  if (compact) {
    return (
      <div
        className={
          'flex items-center gap-2 rounded border-l-4 px-2 py-1 shadow-sm select-none ' +
          (dragging ? 'shadow-lg ring-2 ring-pcl-yellow cursor-grabbing' : 'cursor-grab')
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
        <span className="min-w-0 flex-1 truncate font-sans text-xs font-medium text-pcl-darkgray">
          {project.name}
        </span>
        <span className="shrink-0 font-condensed text-xs font-semibold tabular-nums text-pcl-darkgray">
          {usd.format(cost)}
        </span>
      </div>
    )
  }

  return (
    <div
      className={
        'rounded-md border-l-4 px-3 py-2 shadow-sm select-none ' +
        (dragging ? 'shadow-lg ring-2 ring-pcl-yellow cursor-grabbing' : 'cursor-grab')
      }
      style={{ backgroundColor: color.bg, borderLeftColor: color.border }}
    >
      <div className="font-sans text-sm font-medium leading-snug text-pcl-darkgray">
        {project.name}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: color.border }}
        >
          {project.group} · {project.groupName}
        </span>
        <span className="font-condensed text-base font-semibold tabular-nums text-pcl-darkgray">
          {usd.format(cost)}
        </span>
      </div>
    </div>
  )
}

function DraggableCard({
  project,
  cost,
  compact = false,
  dimmed = false,
}: {
  project: Project
  cost: number
  compact?: boolean
  dimmed?: boolean
}) {
  // Dimmed (filtered-out) cards are non-draggable — disable the sensor entirely.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    disabled: dimmed,
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        // Dimmed: ~15% + non-interactive. Otherwise hide the original while its overlay drags.
        opacity: dimmed ? 0.15 : isDragging ? 0 : 1,
        pointerEvents: dimmed ? 'none' : undefined,
        touchAction: 'none',
      }}
    >
      <ProjectCard project={project} cost={cost} compact={compact} />
    </div>
  )
}

// Inline, click-to-edit per-column cap. Editing is in millions; commits dollars.
function CapEditor({
  year,
  cap,
  isOverridden,
  onCommit,
}: {
  year: number
  cap: number
  isOverridden: boolean
  onCommit: (year: number, capDollars: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function start() {
    setDraft((cap / 1_000_000).toString())
    setEditing(true)
  }
  function commit() {
    setEditing(false)
    const m = parseFloat(draft)
    if (!Number.isNaN(m) && m >= 0) onCommit(year, m * 1_000_000)
  }

  if (editing) {
    return (
      <span className="inline-flex items-center font-condensed text-xs font-semibold text-pcl-darkgray">
        Cap:&nbsp;$
        <input
          autoFocus
          type="number"
          step={5}
          min={0}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="mx-0.5 w-14 rounded border border-pcl-midgray bg-white px-1 py-0.5 text-right tabular-nums outline-none focus:bg-pcl-yellow/30"
        />
        M
      </span>
    )
  }

  return (
    <button
      onClick={start}
      title="Click to set a cap for this year"
      className={
        'font-condensed text-xs font-semibold tabular-nums underline decoration-dotted underline-offset-2 hover:text-pcl-green ' +
        (isOverridden ? 'text-pcl-green' : 'text-pcl-darkgray')
      }
    >
      Cap: {fmtM(cap)}
      {isOverridden ? '*' : ''}
    </button>
  )
}

function YearColumn({
  year,
  projects,
  overlay,
  rate,
  currentTotal,
  baselineTotal,
  cap,
  isCapOverridden,
  onCapCommit,
  density,
  filterActive,
  matches,
}: {
  year: number
  projects: Project[]
  overlay: Overlay
  rate: number
  currentTotal: number
  baselineTotal: number
  cap: number
  isCapOverridden: boolean
  onCapCommit: (year: number, capDollars: number) => void
  density: Density
  filterActive: boolean
  matches: (p: Project) => boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `year-${year}` })

  const items = projects.filter((p) => effectiveYear(p, overlay) === year)
  const compact = density === 'compact'

  // Filtered subtotal: escalated cost of only the matching (full-opacity) cards.
  // View-only — does NOT affect currentTotal, which always reflects every card.
  const filteredSubtotal = filterActive
    ? items.reduce(
        (s, p) => (matches(p) ? s + escalatedCost(p.baseCost, year, rate) : s),
        0,
      )
    : 0

  // Delta vs. the project's default-year placement (both escalated at the current rate).
  const delta = currentTotal - baselineTotal
  const onBaseline = Math.abs(delta) < NEUTRAL_BAND

  // Funding-cap headroom / breach.
  const over = currentTotal - cap
  const breached = over > NEUTRAL_BAND

  return (
    <div
      className={
        'flex min-w-[260px] flex-1 flex-col rounded-lg ' +
        (breached ? 'bg-pcl-orange/10 ring-2 ring-pcl-orange' : 'bg-pcl-lightgray/40')
      }
    >
      <div
        className={
          'sticky top-0 z-10 rounded-t-lg px-3 py-2 ' +
          (breached
            ? 'border-t-4 border-b-2 border-t-pcl-orange border-b-pcl-orange bg-pcl-orange/15'
            : 'border-b-2 border-pcl-yellow bg-pcl-lightgray/70')
        }
      >
        <div className="flex items-baseline justify-between">
          <span className="font-condensed text-2xl font-bold leading-none text-pcl-darkgray">
            {year}
          </span>
          <span className="font-condensed text-xs font-medium uppercase tracking-wide text-pcl-midgray">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {/* Current total — red on breach, green otherwise */}
        <div className="mt-0.5 flex items-baseline gap-2">
          <span
            className={
              'font-condensed text-lg font-semibold tabular-nums ' +
              (breached ? 'text-pcl-orange' : 'text-pcl-green')
            }
          >
            {usd.format(currentTotal)}
          </span>
          {breached && (
            <span className="rounded bg-pcl-orange px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-wide text-white">
              Over cap
            </span>
          )}
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

        {/* Cap (editable) + headroom / overage */}
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 border-t border-pcl-midgray/40 pt-1">
          <CapEditor year={year} cap={cap} isOverridden={isCapOverridden} onCommit={onCapCommit} />
          <span
            className={
              'font-condensed text-xs font-medium tabular-nums ' +
              (breached ? 'font-bold text-pcl-orange' : 'text-pcl-midgray')
            }
          >
            {breached ? `${fmtM(over)} over cap` : `${fmtM(Math.max(0, cap - currentTotal))} under cap`}
          </span>
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

  // Which top-level view is showing. Analytics derives read-only from overlay+rate.
  const [view, setView] = useState<'phasing' | 'analytics'>('phasing')

  // View-only state — derived UI only, no effect on placement/totals/drag.
  const [density, setDensity] = useState<Density>('detailed')
  const [activeTypes, setActiveTypes] = useState<string[]>([]) // empty => "All"
  const filterActive = activeTypes.length > 0
  const matches = (p: Project) => !filterActive || activeTypes.includes(typeOf(p))

  function toggleType(t: string) {
    setActiveTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    )
  }

  // Annual funding cap: one global default, plus optional per-year overrides.
  const DEFAULT_CAP = 150_000_000
  const [globalCap, setGlobalCap] = useState<number>(DEFAULT_CAP)
  const [capOverrides, setCapOverrides] = useState<Record<number, number>>({})
  const effectiveCap = (year: number) => capOverrides[year] ?? globalCap
  const hasCapOverrides = Object.keys(capOverrides).length > 0

  // Small movement threshold so clicks/scroll aren't swallowed by drag activation.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const activeProject = activeId ? PROJECTS.find((p) => p.id === activeId) ?? null : null

  const grandTotal = useMemo(
    () =>
      PROJECTS.reduce(
        (sum, p) => sum + escalatedCost(p.baseCost, effectiveYear(p, overlay), rate),
        0,
      ),
    [overlay, rate],
  )

  const baselineTotal = useMemo(
    () => PROJECTS.reduce((sum, p) => sum + p.baseCost, 0),
    [],
  )

  // Per-year live totals from the assigned-year overlay (escalated at current rate).
  const currentTotals = useMemo(() => {
    const m: Record<number, number> = {}
    for (const y of YEARS) m[y] = 0
    for (const p of PROJECTS) {
      const y = effectiveYear(p, overlay)
      if (m[y] === undefined) m[y] = 0
      m[y] += escalatedCost(p.baseCost, y, rate)
    }
    return m
  }, [overlay, rate])

  // Per-year baseline totals from each project's default-year placement (same rate).
  const baselineTotals = useMemo(() => {
    const m: Record<number, number> = {}
    for (const y of YEARS) m[y] = 0
    for (const p of PROJECTS) {
      const y = p.defaultYear ?? MIN_YEAR
      if (m[y] === undefined) m[y] = 0
      m[y] += escalatedCost(p.baseCost, y, rate)
    }
    return m
  }, [rate])

  const isDirty = Object.keys(overlay).length > 0 || rate !== DEFAULT_ESCALATION

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
  }

  function commitCapOverride(year: number, capDollars: number) {
    setCapOverrides((prev) => ({ ...prev, [year]: capDollars }))
  }

  function resetCaps() {
    setCapOverrides({})
  }

  const ratePct = (rate * 100).toFixed(1)
  const capM = (globalCap / 1_000_000).toString()

  return (
    <div className="flex h-screen flex-col bg-pcl-lightgray/20 text-pcl-darkgray">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b-4 border-pcl-yellow bg-pcl-green px-6 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
        {/* PCL logo placeholder — sized for a horizontal logo (~3:1). Drop the PNG in here. */}
        <div className="flex h-12 w-36 items-center justify-center rounded border-2 border-dashed border-white/50 text-xs font-semibold uppercase tracking-wider text-white/70">
          PCL logo
        </div>
        <div className="mr-auto">
          <h1 className="font-condensed text-2xl font-bold uppercase leading-tight tracking-wide text-white">
            Chase Field — Construction Phasing
          </h1>
          {/* yellow chevron accent under the title */}
          <div className="mt-0.5 h-1 w-24 bg-pcl-yellow" style={{ clipPath: 'polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%)' }} />
          <p className="mt-1 font-sans text-xs text-white/80">
            Drag projects between years to re-phase spend. Totals escalate and re-foot on every drop.
          </p>
          {/* View tabs */}
          <div className="mt-2 inline-flex overflow-hidden rounded-md border border-white/30">
            {(['phasing', 'analytics'] as const).map((v) => (
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
                {v === 'phasing' ? 'Phasing' : 'Analytics'}
              </button>
            ))}
          </div>
        </div>

        {/* Global controls: escalation + annual cap, grouped together */}
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1 font-sans text-xs font-medium text-white/90">
            Escalation / yr
            <div className="flex items-center rounded border border-white/30 bg-white">
              <input
                type="number"
                step={0.1}
                min={0}
                max={100}
                value={ratePct}
                onChange={(e) => setRate(Math.max(0, Number(e.target.value) / 100))}
                className="w-20 rounded-l px-2 py-1 text-right font-condensed tabular-nums text-pcl-darkgray outline-none focus:bg-pcl-yellow/30"
              />
              <span className="px-2 text-pcl-midgray">%</span>
            </div>
          </label>

          {view === 'phasing' && (
            <label className="flex flex-col gap-1 font-sans text-xs font-medium text-white/90">
              Annual cap
              <div className="flex items-center rounded border border-white/30 bg-white">
                <span className="pl-2 text-pcl-midgray">$</span>
                <input
                  type="number"
                  step={5}
                  min={0}
                  value={capM}
                  onChange={(e) => setGlobalCap(Math.max(0, Number(e.target.value) * 1_000_000))}
                  className="w-20 px-1 text-right font-condensed tabular-nums text-pcl-darkgray outline-none focus:bg-pcl-yellow/30"
                />
                <span className="px-2 text-pcl-midgray">M</span>
              </div>
            </label>
          )}
        </div>

        {view === 'phasing' && (
          <div className="flex flex-col gap-1">
            <button
              onClick={resetToBaseline}
              disabled={!isDirty}
              className="rounded border border-white/20 bg-pcl-green px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-pcl-yellow hover:text-pcl-darkgray disabled:cursor-not-allowed disabled:border-transparent disabled:bg-pcl-midgray/40 disabled:text-white/70 disabled:hover:bg-pcl-midgray/40 disabled:hover:text-white/70"
            >
              Reset to baseline
            </button>
            <button
              onClick={resetCaps}
              disabled={!hasCapOverrides}
              className="rounded px-3 py-0.5 font-sans text-[11px] font-medium text-white/80 underline decoration-dotted underline-offset-2 transition-colors hover:text-pcl-yellow disabled:cursor-not-allowed disabled:text-white/40 disabled:no-underline"
            >
              Reset caps
            </button>
          </div>
        )}
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

          {/* Type filter (multi-select; does not remove cards or change totals) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-sans text-xs font-medium uppercase tracking-wide text-white/70">
              Filter
            </span>
            <button
              onClick={() => setActiveTypes([])}
              className={
                'rounded px-2.5 py-1 font-condensed text-xs font-semibold uppercase tracking-wide transition-colors ' +
                (!filterActive
                  ? 'bg-pcl-yellow text-pcl-darkgray'
                  : 'bg-white/10 text-white hover:bg-white/20')
              }
            >
              All
            </button>
            {TYPES.map((t) => {
              const on = activeTypes.includes(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={
                    'rounded px-2.5 py-1 font-condensed text-xs font-semibold uppercase tracking-wide transition-colors ' +
                    (on
                      ? 'bg-pcl-yellow text-pcl-darkgray'
                      : 'bg-white/10 text-white hover:bg-white/20')
                  }
                >
                  {t}
                </button>
              )
            })}
            {filterActive && (
              <button
                onClick={() => setActiveTypes([])}
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
        {/* Columns */}
        <main className="flex flex-1 gap-3 overflow-x-auto p-4">
          {YEARS.map((year) => (
            <YearColumn
              key={year}
              year={year}
              projects={PROJECTS}
              overlay={overlay}
              rate={rate}
              currentTotal={currentTotals[year] ?? 0}
              baselineTotal={baselineTotals[year] ?? 0}
              cap={effectiveCap(year)}
              isCapOverridden={capOverrides[year] !== undefined}
              onCapCommit={commitCapOverride}
              density={density}
              filterActive={filterActive}
              matches={matches}
            />
          ))}
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
        <span className="ml-auto font-sans text-xs text-white/70">
          {PROJECTS.length} projects · {YEARS[0]}–{YEARS[YEARS.length - 1]} · {ratePct}% / yr
        </span>
      </footer>
        </>
      ) : (
        <Analytics overlay={overlay} rate={rate} />
      )}
    </div>
  )
}
