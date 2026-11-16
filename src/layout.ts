import type { Anomaly, RehoboamModel } from "./types";

/** All angles are in degrees, 0 at twelve o'clock, increasing clockwise. */
export interface ClassSlot {
  id: string;
  label: string;
  groupId: string;
  start: number;
  end: number;
  /** Centre of the slot. */
  angle: number;
}

export interface GroupSector {
  id: string;
  label: string;
  start: number;
  end: number;
  angle: number;
  classes: ClassSlot[];
}

export interface PlacedAnomaly {
  key: string;
  anomaly: Anomaly;
  group: GroupSector;
  slot: ClassSlot;
  angle: number;
  /** Angular half-width of the flare. */
  halfWidth: number;
  /** Strength clamped to 0..1. */
  strength: number;
}

export interface LayoutOptions {
  /** Where the first group starts. Default 0 (twelve o'clock). */
  startAngle?: number;
  /** Empty space between neighbouring groups. Default 6. */
  groupGap?: number;
  /**
   * "equal" gives every group the same sector; "proportional" sizes a sector
   * by its number of classes, so every class slot is the same width.
   */
  groupSizing?: "equal" | "proportional";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Divides the 360° ring into one sector per group and one slot per class. */
export function computeLayout(
  groups: RehoboamModel["groups"],
  { startAngle = 0, groupGap = 6, groupSizing = "equal" }: LayoutOptions = {},
): GroupSector[] {
  const count = groups.length;
  if (count === 0) return [];
  const gap = count > 1 ? clamp(groupGap, 0, 360 / count - 1) : 0;
  const usable = 360 - gap * count;
  const weights = groups.map((g) =>
    groupSizing === "proportional" ? Math.max(1, g.classes.length) : 1,
  );
  const total = weights.reduce((a, b) => a + b, 0);

  let cursor = startAngle + gap / 2;
  return groups.map((group, gi) => {
    const span = (usable * weights[gi]) / total;
    const start = cursor;
    const end = start + span;
    cursor = end + gap;
    const slotSpan = span / Math.max(1, group.classes.length);
    const classes = group.classes.map((c, ci) => {
      const s = start + ci * slotSpan;
      return {
        id: c.id,
        label: c.label ?? c.id,
        groupId: group.id,
        start: s,
        end: s + slotSpan,
        angle: s + slotSpan / 2,
      };
    });
    return {
      id: group.id,
      label: group.label ?? group.id,
      start,
      end,
      angle: start + span / 2,
      classes,
    };
  });
}

/**
 * Resolves each anomaly to an angle. Anomalies that share a class are spread
 * evenly across that class's slot. Anomalies naming an unknown group or class
 * are dropped.
 */
export function placeAnomalies(
  anomalies: Anomaly[],
  sectors: GroupSector[],
): PlacedAnomaly[] {
  const slots = new Map<string, { group: GroupSector; slot: ClassSlot }>();
  for (const group of sectors)
    for (const slot of group.classes) slots.set(`${group.id}\u0000${slot.id}`, { group, slot });

  const bySlot = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    const k = `${a.groupId}\u0000${a.classId}`;
    if (!slots.has(k)) continue;
    const list = bySlot.get(k);
    if (list) list.push(a);
    else bySlot.set(k, [a]);
  }

  const placed: PlacedAnomaly[] = [];
  for (const [k, list] of bySlot) {
    const { group, slot } = slots.get(k)!;
    const share = (slot.end - slot.start) / list.length;
    list.forEach((anomaly, i) => {
      placed.push({
        key: anomaly.id ?? `${anomaly.groupId}/${anomaly.classId}/${i}`,
        anomaly,
        group,
        slot,
        angle: slot.start + share * (i + 0.5),
        halfWidth: clamp(share * 0.9, 3, 18),
        strength: clamp(Number.isFinite(anomaly.strength) ? anomaly.strength : 0, 0, 1),
      });
    });
  }
  return placed;
}
