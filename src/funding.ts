// Public/private funding split. One mechanism — a single "public %" per project —
// covers all three cases: 100 = fully public, 0 = fully private, anything between
// = a split. Derived from a group-keyed assumptions table; it is a NEW OVERLAY
// layered on top of the source data, never written back into chaseFieldProjects.
import { PROJECTS, type Project } from './data/chaseFieldProjects'

// ── Funding-split assumptions ────────────────────────────────────────────────
// Default public % keyed by project GROUP. This is the single knob the team tunes:
// edit a number here and every project in that group re-splits.
//
// IMPORTANT — PLANNING ASSUMPTIONS, NOT LEGAL DETERMINATIONS.
// These percentages are estimates used only to phase/visualize cost. They do NOT
// assert what is contractually or legally public vs. private money.
//   • Infrastructure groups are assumed largely public — base building, structure,
//     and MEP that the public facility ultimately owns.
//   • Premium/program groups carry public ONLY as the embedded base-building /
//     structural / MEP portion of that space; the premium fit-out is private.
export const FUNDING_SPLIT_DEFAULTS: Record<string, number> = {
  // Infrastructure groups → high public
  J: 100, // Structural Concrete
  K: 100, // Roof
  M: 100, // Mechanical
  N: 100, // Electrical
  O: 100, // Plumbing
  L: 100, // Telecom
  P: 100, // Security
  Q: 50, //  AV & Broadcast

  // Premium/program groups → public = embedded base-building/structural/MEP portion
  A: 30, // Home Plate Club
  B: 25, // Home Clubhouse
  C: 25, // Visiting Clubhouse & Umpire
  D: 30, // Left Field
  E: 30, // Right Field
  G: 40, // Main Concourse
  H: 30, // Suite/Diamond Level
  I: 40, // Upper Concourse
}

// Neutral fallback if a project's group is ever missing from the table — a new
// group should land at a visible 50/50, never silently at 0 or 100.
export const FUNDING_SPLIT_FALLBACK = 50

// Public-% overlay: projectId -> public %. Same overlay pattern as timing/year.
export type FundingOverlay = Record<string, number>

// Default public % for a project, from its group (or the neutral fallback).
export function defaultPublicPct(p: Project): number {
  return FUNDING_SPLIT_DEFAULTS[p.group] ?? FUNDING_SPLIT_FALLBACK
}

// Seed the overlay from group defaults — one entry per project. Provided for the
// future editing UI; current totals can read defaults directly.
export function seedFunding(): FundingOverlay {
  const m: FundingOverlay = {}
  for (const p of PROJECTS) m[p.id] = defaultPublicPct(p)
  return m
}

// Current public % for a project: overlay override wins, else the group default.
export function publicPct(p: Project, overlay: FundingOverlay = {}): number {
  return overlay[p.id] ?? defaultPublicPct(p)
}

// Public portion of an already-escalated cost. Private is intentionally taken as
// (escalated − public) at the totals layer so each item's two halves sum to its
// escalated cost exactly, keeping public + private == grand total to the dollar.
export function publicCost(escalated: number, pct: number): number {
  return escalated * (pct / 100)
}
export function privateCost(escalated: number, pct: number): number {
  return escalated - publicCost(escalated, pct)
}
