import { useMemo, useState } from "react";

// ── PCL Capital Program Planner — Venue Map tab ──────────────────────────────
// Shows renovation work spatially, by year. Seating & premium areas render on a
// schematic stadium bowl; building-wide systems render as labeled boxes (a roof
// box, an HVAC box, etc.) because that work isn't tied to one seating location.
//
// Click a year  → every area with work that year highlights, and the year's
//                  total escalated spend shows in the header.
// Hover an area → tooltip with that area's spend (for the selected year, or its
//                  full-program total when no year is selected).
//
// DATA: pass `projects` from the same app state the rest of the dashboard uses
// (current assigned year + exclusions already applied, escalation handled here),
// so this view never contradicts the Phasing / Analytics tabs. If `projects`
// is omitted it falls back to the baseline matrix data below.
// ─────────────────────────────────────────────────────────────────────────────

export interface VenueProject {
  group: string;        // A–Q
  groupName: string;
  year: number;         // current assigned year (defaults to matrix phase year)
  baseCost: number;     // fully-loaded, un-escalated
}

interface Props {
  projects?: VenueProject[];
  escalationRate?: number; // e.g. 0.05
  minYear?: number;        // escalation base year (defaults to min year present)
}

// ── PCL brand tokens ─────────────────────────────────────────────────────────
const PCL = {
  green: "#00502F",
  yellow: "#FFC425",
  darkGray: "#36383D",
  midGray: "#A6A6A6",
  lightGray: "#CFCFCF",
  indigo: "#4E5BA8",
  purple: "#941F6E",
  lightGreen: "#098371",
  orange: "#D83C31",
};

// Year → color (PCL palette, 7 distinguishable)
const YC: Record<number, string> = {
  2026: PCL.orange,
  2027: PCL.yellow,
  2028: PCL.lightGreen,
  2029: PCL.green,
  2030: PCL.indigo,
  2031: PCL.purple,
  2032: PCL.darkGray,
};
const lightText = (y: number) => y === 2027; // dark text only on yellow

// Group → how it's represented. arc/ring live on the bowl; box = clubhouse;
// sys = building-wide system box with an icon.
type Kind = "arc" | "ring" | "box" | "sys";
const GROUPS: Record<string, { name: string; kind: Kind; icon?: string }> = {
  A: { name: "Home Plate Club", kind: "arc" },
  B: { name: "Home Clubhouse", kind: "box" },
  C: { name: "Visiting Clubhouse", kind: "box" },
  D: { name: "Left Field", kind: "arc" },
  E: { name: "Right Field", kind: "arc" },
  G: { name: "Main Concourse", kind: "ring" },
  H: { name: "Suite / Diamond", kind: "ring" },
  I: { name: "Upper Concourse", kind: "ring" },
  J: { name: "Concrete", kind: "sys", icon: "ti-building" },
  K: { name: "Roof", kind: "sys", icon: "ti-home" },
  L: { name: "Telecom", kind: "sys", icon: "ti-network" },
  M: { name: "Mechanical / HVAC", kind: "sys", icon: "ti-air-conditioning" },
  N: { name: "Electrical", kind: "sys", icon: "ti-bolt" },
  O: { name: "Plumbing", kind: "sys", icon: "ti-droplet" },
  P: { name: "Security", kind: "sys", icon: "ti-shield" },
  Q: { name: "AV & Broadcast", kind: "sys", icon: "ti-device-tv" },
};

// Baseline matrix data (group, year, base cost) — used when no `projects` prop.
const BASELINE: VenueProject[] = [
  { group: "A", groupName: "Home Plate Club", year: 2028, baseCost: 33381561 },
  { group: "B", groupName: "Home Clubhouse", year: 2028, baseCost: 17940972 },
  { group: "C", groupName: "Visiting Clubhouse & Umpire", year: 2028, baseCost: 13767685 },
  { group: "D", groupName: "Left Field", year: 2026, baseCost: 1509273 },
  { group: "E", groupName: "Right Field", year: 2027, baseCost: 23021946 },
  { group: "G", groupName: "Main Concourse", year: 2027, baseCost: 5884435 },
  { group: "G", groupName: "Main Concourse", year: 2030, baseCost: 6398974 },
  { group: "H", groupName: "Suite/Diamond Level", year: 2027, baseCost: 25719484 },
  { group: "I", groupName: "Upper Concourse", year: 2026, baseCost: 10535132 },
  { group: "I", groupName: "Upper Concourse", year: 2031, baseCost: 15646251 },
  { group: "J", groupName: "Structural Concrete", year: 2026, baseCost: 4367040 },
  { group: "J", groupName: "Structural Concrete", year: 2027, baseCost: 3494400 },
  { group: "J", groupName: "Structural Concrete", year: 2028, baseCost: 4506528 },
  { group: "J", groupName: "Structural Concrete", year: 2029, baseCost: 3588000 },
  { group: "J", groupName: "Structural Concrete", year: 2030, baseCost: 3808896 },
  { group: "J", groupName: "Structural Concrete", year: 2031, baseCost: 8486400 },
  { group: "J", groupName: "Structural Concrete", year: 2032, baseCost: 3588000 },
  { group: "K", groupName: "Roof", year: 2026, baseCost: 24721920 },
  { group: "K", groupName: "Roof", year: 2029, baseCost: 6567104 },
  { group: "K", groupName: "Roof", year: 2030, baseCost: 1189376 },
  { group: "K", groupName: "Roof", year: 2031, baseCost: 971520 },
  { group: "K", groupName: "Roof", year: 2032, baseCost: 908480 },
  { group: "L", groupName: "Telecom", year: 2026, baseCost: 4736000 },
  { group: "L", groupName: "Telecom", year: 2027, baseCost: 4736000 },
  { group: "L", groupName: "Telecom", year: 2028, baseCost: 12373333 },
  { group: "L", groupName: "Telecom", year: 2029, baseCost: 10837333 },
  { group: "L", groupName: "Telecom", year: 2030, baseCost: 2901333 },
  { group: "M", groupName: "Mechanical", year: 2026, baseCost: 37888000 },
  { group: "M", groupName: "Mechanical", year: 2027, baseCost: 27178667 },
  { group: "M", groupName: "Mechanical", year: 2028, baseCost: 15146667 },
  { group: "M", groupName: "Mechanical", year: 2029, baseCost: 15146667 },
  { group: "N", groupName: "Electrical", year: 2027, baseCost: 23082667 },
  { group: "N", groupName: "Electrical", year: 2028, baseCost: 9002667 },
  { group: "N", groupName: "Electrical", year: 2029, baseCost: 9002667 },
  { group: "N", groupName: "Electrical", year: 2030, baseCost: 640000 },
  { group: "O", groupName: "Plumbing", year: 2027, baseCost: 5984000 },
  { group: "O", groupName: "Plumbing", year: 2028, baseCost: 12000000 },
  { group: "O", groupName: "Plumbing", year: 2029, baseCost: 11744000 },
  { group: "O", groupName: "Plumbing", year: 2030, baseCost: 10208000 },
  { group: "O", groupName: "Plumbing", year: 2031, baseCost: 11712000 },
  { group: "O", groupName: "Plumbing", year: 2032, baseCost: 4416000 },
  { group: "P", groupName: "Security", year: 2027, baseCost: 9472000 },
  { group: "P", groupName: "Security", year: 2028, baseCost: 17446400 },
  { group: "P", groupName: "Security", year: 2029, baseCost: 10508800 },
  { group: "P", groupName: "Security", year: 2030, baseCost: 9856000 },
  { group: "Q", groupName: "AV & Broadcast", year: 2027, baseCost: 13312000 },
  { group: "Q", groupName: "AV & Broadcast", year: 2028, baseCost: 26009600 },
  { group: "Q", groupName: "AV & Broadcast", year: 2029, baseCost: 36208640 },
];

// ── geometry helpers ─────────────────────────────────────────────────────────
const CX = 340, CY = 215;
const polar = (r: number, aDeg: number) => {
  const a = (aDeg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
};
function annular(a0: number, a1: number, ri: number, ro: number) {
  const steps = Math.max(2, Math.round((a1 - a0) / 3));
  const d: string[] = [];
  let p = polar(ri, a0); d.push(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}`);
  p = polar(ro, a0); d.push(`L${p[0].toFixed(1)} ${p[1].toFixed(1)}`);
  for (let i = 1; i <= steps; i++) { p = polar(ro, a0 + ((a1 - a0) * i) / steps); d.push(`L${p[0].toFixed(1)} ${p[1].toFixed(1)}`); }
  p = polar(ri, a1); d.push(`L${p[0].toFixed(1)} ${p[1].toFixed(1)}`);
  for (let i = 1; i <= steps; i++) { p = polar(ri, a1 - ((a1 - a0) * i) / steps); d.push(`L${p[0].toFixed(1)} ${p[1].toFixed(1)}`); }
  d.push("Z");
  return d.join(" ");
}

const ARC: Record<string, string> = {
  D: annular(145, 228, 50, 82),
  A: annular(228, 312, 50, 82),
  E: annular(312, 395, 50, 82),
  G: annular(145, 395, 88, 111),
  H: annular(145, 395, 116, 139),
  I: annular(145, 395, 144, 167),
};

const fmtM = (n: number) => `$${(n / 1e6).toFixed(1)}M`;
const fmtFull = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function ChaseFieldVenueMap({ projects, escalationRate = 0.05, minYear }: Props) {
  const data = projects && projects.length ? projects : BASELINE;
  const base = minYear ?? Math.min(...data.map((d) => d.year));
  const [year, setYear] = useState<number | null>(null);
  const [hover, setHover] = useState<{ g: string; x: number; y: number } | null>(null);

  // group → year → escalated spend, and group → activeYears, and year → total
  const { spend, activeYears, yearTotal, years } = useMemo(() => {
    const spend: Record<string, Record<number, number>> = {};
    const yearTotal: Record<number, number> = {};
    const ySet = new Set<number>();
    for (const p of data) {
      const esc = p.baseCost * Math.pow(1 + escalationRate, p.year - base);
      spend[p.group] = spend[p.group] || {};
      spend[p.group][p.year] = (spend[p.group][p.year] || 0) + esc;
      yearTotal[p.year] = (yearTotal[p.year] || 0) + esc;
      ySet.add(p.year);
    }
    const activeYears: Record<string, number[]> = {};
    for (const g in spend) activeYears[g] = Object.keys(spend[g]).map(Number).sort();
    return { spend, activeYears, yearTotal, years: [...ySet].sort() };
  }, [data, escalationRate, base]);

  const isActive = (g: string) => (year == null ? true : (activeYears[g] || []).includes(year));
  const groupSpendFor = (g: string) =>
    year == null
      ? Object.values(spend[g] || {}).reduce((a, b) => a + b, 0)
      : (spend[g]?.[year] || 0);

  const zoneFill = (g: string) => {
    if (year == null) return "#cbc7bf";
    return isActive(g) ? YC[year] : "#e5e3dc";
  };
  const zoneOpacity = (g: string) => (year == null || isActive(g) ? 1 : 0.4);

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "Barlow, system-ui, sans-serif", color: PCL.darkGray, position: "relative" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 style={{ fontFamily: "'Barlow Condensed', Barlow, sans-serif", fontWeight: 700, fontSize: 24, color: PCL.green, margin: 0, textTransform: "uppercase", letterSpacing: "0.01em" }}>
          Venue Map — Work by Year
        </h2>
        {year != null && (
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 20, color: PCL.darkGray }}>
            {year}: <span style={{ color: PCL.green }}>{fmtM(yearTotal[year] || 0)}</span>
          </span>
        )}
      </div>
      <div style={{ height: 3, width: 120, background: PCL.yellow, marginBottom: 12 }} />

      {/* Two-column layout: bowl (left) + controls (right). flexWrap collapses to a
          single stacked column on narrow/mobile screens (bowl on top, controls below). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        {/* LEFT — bowl. Capped to a fixed, reasonable size and centered so the SVG
            never fills the whole viewport. */}
        <div style={{ flex: "3 1 420px", minWidth: 0 }}>
          <div style={{ maxWidth: 600, margin: "0 auto", width: "100%" }}>
            <svg width="100%" viewBox="160 105 360 350" role="img" style={{ display: "block", width: "100%", maxHeight: 600 }}>
              <title>Chase Field renovation by year</title>
              {/* field */}
              <circle cx={CX} cy={CY} r={46} fill="#3f7d44" opacity={0.9} />
              <path d={`M${CX} ${CY + 46} L${CX + 46} ${CY} L${CX} ${CY - 46} L${CX - 46} ${CY} Z`} fill="#b07c4a" opacity={0.85} />
              <circle cx={CX} cy={CY} r={7} fill="#9c6b3e" />

              {/* seating zones */}
              {(["D", "A", "E", "G", "H", "I"] as const).map((g) => (
                <path
                  key={g}
                  d={ARC[g]}
                  fill={zoneFill(g)}
                  opacity={zoneOpacity(g)}
                  stroke={year != null && isActive(g) ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.5)"}
                  strokeWidth={0.6}
                  style={{ cursor: "pointer", transition: "fill .15s, opacity .15s" }}
                  onMouseEnter={(e) => setHover({ g, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHover({ g, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                />
              ))}

              {/* clubhouse boxes (field-level, premium) */}
              {(["B", "C"] as const).map((g, i) => {
                const x = i === 0 ? 172 : 352;
                const active = isActive(g);
                return (
                  <g
                    key={g}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => setHover({ g, x: e.clientX, y: e.clientY })}
                    onMouseMove={(e) => setHover({ g, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <rect x={x} y={402} width={156} height={40} rx={8}
                      fill={year == null ? "#e9e6df" : active ? YC[year] : "#e9e6df"}
                      opacity={year == null || active ? 1 : 0.4}
                      stroke={PCL.midGray} strokeWidth={0.5} style={{ transition: "fill .15s, opacity .15s" }} />
                    <text x={x + 78} y={422} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={500} fill={PCL.darkGray} style={{ pointerEvents: "none" }}>
                      {GROUPS[g].name}
                    </text>
                  </g>
                );
              })}
              <line x1={262} y1={382} x2={250} y2={402} stroke={PCL.midGray} strokeWidth={0.5} strokeDasharray="3 3" />
              <line x1={418} y1={382} x2={430} y2={402} stroke={PCL.midGray} strokeWidth={0.5} strokeDasharray="3 3" />

              {/* zone labels */}
              {([
                [266, 222, "Left field", false],
                [340, 281, "Home plate", true],
                [414, 222, "Right field", false],
                [340, 314, "Main concourse", true],
                [340, 342, "Suite / diamond", true],
                [340, 370, "Upper concourse", true],
              ] as const).map(([x, y, t, pill], idx) => (
                <g key={idx} style={{ pointerEvents: "none" }}>
                  {pill && <rect x={(x as number) - String(t).length * 3.4 - 5} y={(y as number) - 9} width={String(t).length * 6.8 + 10} height={16} rx={8} fill="#ffffff" opacity={0.82} />}
                  <text x={x as number} y={y as number} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={500}
                    fill={PCL.darkGray} stroke="#fff" strokeWidth={pill ? 0 : 2.5} paintOrder="stroke">
                    {t}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* RIGHT — controls. Systems boxes (one per row), year chips, year total, info line. */}
        <div style={{ flex: "2 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Systems boxes — stacked vertically, one per row */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: PCL.midGray, margin: "0 0 8px", letterSpacing: "0.05em" }}>
              BUILDING-WIDE SYSTEMS
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
              {(["J", "K", "L", "M", "N", "O", "P", "Q"] as const).map((g) => {
                const active = isActive(g);
                const bg = year != null && active ? YC[year] : "#ffffff";
                const txt = year != null && active && !lightText(year) ? "#fff" : PCL.darkGray;
                return (
                  <div
                    key={g}
                    onMouseEnter={(e) => setHover({ g, x: e.clientX, y: e.clientY })}
                    onMouseMove={(e) => setHover({ g, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}
                    style={{
                      display: "flex", alignItems: "center", gap: 9, padding: "7px 11px",
                      border: `1px solid ${year != null && active ? bg : PCL.lightGray}`,
                      borderRadius: 8, background: bg, opacity: year == null || active ? 1 : 0.4,
                      cursor: "pointer", transition: ".15s",
                    }}
                  >
                    <i className={`ti ${GROUPS[g].icon}`} style={{ fontSize: 18, color: txt }} aria-hidden="true" />
                    <span style={{ fontSize: 13, fontWeight: 500, color: txt }}>{GROUPS[g].name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Year chips */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))", gap: 6 }}>
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setYear(year === y ? null : y)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  padding: "7px 6px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                  background: "#fff", color: PCL.darkGray,
                  border: year === y ? `2px solid ${YC[y]}` : `1px solid ${PCL.lightGray}`,
                }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 3, background: YC[y] }} />
                {y}
              </button>
            ))}
          </div>

          {/* Year total */}
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 18, color: PCL.darkGray }}>
            {year == null ? (
              <span style={{ color: PCL.midGray }}>All years — <span style={{ color: PCL.green }}>{fmtM(Object.values(yearTotal).reduce((a, b) => a + b, 0))}</span></span>
            ) : (
              <span>{year}: <span style={{ color: PCL.green }}>{fmtM(yearTotal[year] || 0)}</span></span>
            )}
          </div>

          {/* Info line */}
          <div style={{ padding: "10px 14px", background: "#f4f5f3", borderRadius: 12, fontSize: 13, lineHeight: 1.5, color: PCL.darkGray }}>
            {year == null ? (
              <>Click a year to highlight every area with work that year — on the bowl and in the systems boxes. Hover any area for its spend.</>
            ) : (
              <>
                <strong>{year} — {fmtM(yearTotal[year] || 0)}</strong> across{" "}
                {Object.keys(GROUPS).filter((g) => isActive(g)).map((g) => GROUPS[g].name).join(" · ")}
              </>
            )}
          </div>

          <button
            onClick={() => setYear(null)}
            style={{ alignSelf: "flex-start", fontSize: 13, padding: "6px 14px", borderRadius: 8, border: `1px solid ${PCL.lightGray}`, background: "#fff", cursor: "pointer", color: PCL.darkGray }}
          >
            Show all
          </button>
        </div>
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div
          style={{
            position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 50, pointerEvents: "none",
            background: PCL.darkGray, color: "#fff", padding: "8px 11px", borderRadius: 8, fontSize: 12.5,
            boxShadow: "0 4px 14px rgba(0,0,0,0.22)", maxWidth: 240,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{GROUPS[hover.g].name}</div>
          <div style={{ color: PCL.yellow, fontWeight: 600 }}>
            {fmtFull(groupSpendFor(hover.g))}
          </div>
          <div style={{ color: PCL.lightGray, fontSize: 11, marginTop: 2 }}>
            {year == null ? `Total · active ${(activeYears[hover.g] || []).join(", ")}` : `in ${year}`}
          </div>
        </div>
      )}
    </div>
  );
}
