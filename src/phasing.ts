// Shared, pure phasing math. Imported by both the Phasing board and the read-only
// Analytics view so they always compute identical escalated values.
import { PROJECTS, YEARS, type Project } from './data/chaseFieldProjects'

export const MIN_YEAR = Math.min(...YEARS)

// Assigned-year overlay: projectId -> year. Absent => fall back to the project's own year.
export type Overlay = Record<string, number>

// Scope-exclusion overlay: the set of excluded projectIds. Default empty => all
// included. Excluded items are kept on the board but counted by no total or chart.
export type Exclusions = Set<string>
export const isIncluded = (p: Project, excluded: Exclusions): boolean => !excluded.has(p.id)

// Season timing. A project is either explicitly Offseason or Year-Round; anything
// the source leaves blank is honestly "unknown" (never silently Offseason).
export type Timing = 'offseason' | 'yearround'
export type EffectiveTiming = Timing | 'unknown'

// Timing overlay: projectId -> overridden timing. Absent => fall back to source.
export type TimingOverlay = Record<string, Timing>

// Map the raw source field to a normalized timing (or 'unknown' when blank).
export function sourceTiming(p: Project): EffectiveTiming {
  if (p.timing === 'Offseason') return 'offseason'
  if (p.timing === 'Year-Round') return 'yearround'
  return 'unknown'
}

// Seed the overlay from the source field. Only known values are seeded; blanks
// stay absent so they resolve to 'unknown' until the user sets them explicitly.
export function seedTiming(): TimingOverlay {
  const m: TimingOverlay = {}
  for (const p of PROJECTS) {
    const t = sourceTiming(p)
    if (t !== 'unknown') m[p.id] = t
  }
  return m
}

// Current timing for a project: override wins, else the source value.
export function effectiveTiming(p: Project, overlay: TimingOverlay): EffectiveTiming {
  return overlay[p.id] ?? sourceTiming(p)
}

// Card cost grown from its base by the global rate over the years it slips past MIN_YEAR.
export function escalatedCost(baseCost: number, assignedYear: number, rate: number): number {
  return baseCost * Math.pow(1 + rate, assignedYear - MIN_YEAR)
}

export function effectiveYear(p: Project, overlay: Overlay): number {
  return overlay[p.id] ?? p.defaultYear ?? MIN_YEAR
}

// Compact millions, one decimal: 12_300_000 -> "$12.3M".
export function fmtM(n: number): string {
  return `$${(n / 1_000_000).toFixed(1)}M`
}
