// One stable, distinct color per project group letter, drawn from the PCL brand.
// The four leading entries are the exact secondary-palette tokens; the dataset has
// 16 groups, so the list is extended with on-brand hues to keep every group distinct.
// Card text is the brand dark gray (set via Tailwind class), so we only need the
// accent color here — the light card fill is mixed from it at render time.
export interface GroupColor {
  bg: string // light tint used as the card fill
  border: string // accent — left bar + category badge
}

// Accent colors. First four are the brand secondary palette (indigo, purple,
// light green, orange), then PCL green and additional harmonious brand hues.
const ACCENTS: string[] = [
  '#4E5BA8', // indigo   (secondary palette)
  '#941F6E', // purple   (secondary palette)
  '#098371', // light green (secondary palette)
  '#D83C31', // orange   (secondary palette)
  '#00502F', // PCL green (primary)
  '#2F6FB0', // blue
  '#6D3FA0', // violet
  '#C6792A', // ochre
  '#0E7C86', // teal
  '#A8123E', // crimson
  '#5E8C31', // olive
  '#B83C8E', // magenta
  '#36383D', // dark gray
  '#7A5C12', // bronze
  '#1F7A5A', // emerald
  '#4A4E69', // slate violet
]

const cache = new Map<string, GroupColor>()

// Map each distinct group letter to an accent deterministically.
export function colorForGroup(group: string): GroupColor {
  let color = cache.get(group)
  if (!color) {
    // 'A' -> 0, 'B' -> 1, ... wraps if more groups than accents.
    const idx = (group.charCodeAt(0) - 65 + 256) % ACCENTS.length
    const accent = ACCENTS[idx]
    // Light fill derived from the accent so the card stays tied to its brand color.
    color = { border: accent, bg: `color-mix(in srgb, ${accent} 10%, white)` }
    cache.set(group, color)
  }
  return color
}
