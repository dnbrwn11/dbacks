// Shared, pure phasing math. Imported by both the Phasing board and the read-only
// Analytics view so they always compute identical escalated values.
import { YEARS, type Project } from './data/chaseFieldProjects'

export const MIN_YEAR = Math.min(...YEARS)

// Assigned-year overlay: projectId -> year. Absent => fall back to the project's own year.
export type Overlay = Record<string, number>

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
