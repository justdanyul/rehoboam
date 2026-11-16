/** One kind of anomaly inside a group. Each class owns a fixed slot on the ring. */
export interface AnomalyClass {
  id: string;
  /** Display name. Falls back to `id`. */
  label?: string;
}

/** A family of anomaly classes. Each group owns one sector of the ring. */
export interface AnomalyGroup {
  id: string;
  /** Display name. Falls back to `id`. */
  label?: string;
  classes: AnomalyClass[];
}

/** An observed anomaly. It produces a flare at its class's slot. */
export interface Anomaly {
  /** Stable identity, used to animate the flare between model updates. */
  id?: string;
  groupId: string;
  classId: string;
  /** Flare size, from 0 (none) to 1 (full height). Values outside are clamped. */
  strength: number;
  /** Second line of the callout, e.g. "PM2.5 : 51.8 µg/m³". */
  detail?: string;
  /** Overrides the callout title (default: "GROUP: CLASS"). */
  label?: string;
}

export interface RehoboamModel {
  /** G groups, laid out clockwise around the ring in the order given. */
  groups: AnomalyGroup[];
  /** The anomalies currently observed. */
  anomalies: Anomaly[];
}
