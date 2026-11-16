import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  computeLayout,
  placeAnomalies,
  type GroupSector,
  type LayoutOptions,
  type PlacedAnomaly,
} from "./layout";
import { CoronaRenderer, bandWidth, swellAt, type Geometry } from "./renderer";
import type { Anomaly, RehoboamModel } from "./types";

export interface RehoboamLabel {
  title: string;
  subtitle?: string;
}

/**
 * When a kind of label is shown: all the time, only while the pointer is over
 * the thing it describes, or not at all.
 */
export type LabelMode = "always" | "hover" | "never";

export interface RehoboamProps extends LayoutOptions {
  model: RehoboamModel;
  /** CSS size. Default: 100% wide. */
  width?: number | string;
  /** CSS size. Default: derived from a 16:9 aspect ratio. */
  height?: number | string;
  /** The single ink colour. Default: inherits the CSS `color`. */
  color?: string;
  /** Background behind the plot. Default: transparent. */
  background?: string;
  /** Disc radius as a fraction of the smaller side. Default 0.3. */
  radius?: number;
  /** Height of a strength-1 flare as a fraction of the disc radius. Default 0.5. */
  flareScale?: number;
  /** How blurred the smoke is. 0 is crisp, 1 the default. */
  softness?: number;
  /** Direction of the heavy, eclipsed side, in degrees clockwise from twelve o'clock. Default 280. */
  eclipseAngle?: number;
  /**
   * Anomaly callouts. "hover" shows a callout while the pointer is over its
   * flare. Default "always".
   */
  anomalyLabels?: LabelMode;
  /**
   * Group names and class ticks inside the disc. "hover" shows a group's
   * while the pointer is over its sector. Default "always".
   */
  groupLabels?: LabelMode;
  /** With anomalyLabels="always", only the strongest N anomalies get a callout. Default 8. */
  maxLabels?: number;
  /** With anomalyLabels="always", anomalies weaker than this get no callout. Default 0. */
  labelThreshold?: number;
  /** Animate the corona. Default true; always off under prefers-reduced-motion. */
  animate?: boolean;
  /** Animation speed multiplier. Default 1. */
  speed?: number;
  /** Customise callout text. */
  formatLabel?: (placed: PlacedAnomaly) => RehoboamLabel;
  /** Fired when a flare or its callout is clicked. */
  onAnomalyClick?: (anomaly: Anomaly) => void;
  /** Fired when the pointer moves onto or off a flare or its callout. */
  onAnomalyHover?: (anomaly: Anomaly | null) => void;
  className?: string;
  style?: CSSProperties;
}

const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => [
  cx + r * Math.sin(deg * RAD),
  cy - r * Math.cos(deg * RAD),
];

const defaultLabel = (p: PlacedAnomaly): RehoboamLabel => ({
  title: p.anomaly.label ?? `${p.group.label}: ${p.slot.label}`,
  subtitle: p.anomaly.detail ?? `Strength : ${Math.round(p.strength * 100)} %`,
});

/** Radius of the tip of an anomaly's flare. */
const tipRadius = (p: PlacedAnomaly, g: Geometry) =>
  g.radius +
  bandWidth(g.radius) +
  swellAt(g.radius, p.angle * RAD, g.heavyAngle) +
  p.strength * g.flareHeight;

interface Callout {
  placed: PlacedAnomaly;
  label: RehoboamLabel;
  mx: number;
  my: number;
  side: 1 | -1;
  lineY: number;
  elbowX: number;
  endX: number;
}

const MARKER = 9;
const HEXAGON = Array.from({ length: 6 }, (_, i) => {
  const a = (i * 60 - 90) * RAD;
  return `${(MARKER * Math.cos(a)).toFixed(2)},${(MARKER * Math.sin(a)).toFixed(2)}`;
}).join(" ");
const FADE = "opacity 180ms ease";

function layoutCallouts(
  placed: PlacedAnomaly[],
  g: Geometry,
  max: number,
  threshold: number,
  format: (p: PlacedAnomaly) => RehoboamLabel,
): Callout[] {
  const R = g.radius;
  const rise = clamp(R * 0.3, 28, 64);
  const callouts: Callout[] = placed
    .filter((p) => p.strength > 0 && p.strength >= threshold)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, Math.max(0, max))
    .map((p) => {
      const [mx, my] = polar(g.cx, g.cy, tipRadius(p, g) + MARKER + 3, p.angle);
      const side: 1 | -1 = Math.sin(p.angle * RAD) >= -1e-9 ? 1 : -1;
      const up = my < g.cy + R * 0.35;
      return {
        placed: p,
        label: format(p),
        mx,
        my,
        side,
        lineY: my + (up ? -rise : rise),
        elbowX: 0,
        endX: 0,
      };
    });

  // Keep callouts on the same side from overlapping.
  const gap = 46;
  const top = 40;
  const bottom = g.height - 10;
  for (const side of [1, -1] as const) {
    const column = callouts.filter((c) => c.side === side).sort((a, b) => a.lineY - b.lineY);
    column.forEach((c, i) => {
      c.lineY = Math.max(c.lineY, i === 0 ? top : column[i - 1].lineY + gap);
    });
    for (let i = column.length - 1; i >= 0; i--) {
      const limit = i === column.length - 1 ? bottom : column[i + 1].lineY - gap;
      column[i].lineY = Math.min(column[i].lineY, limit);
    }
  }

  const length = clamp(g.width * 0.26, 140, 300);
  for (const c of callouts) {
    c.elbowX = c.mx + c.side * (Math.abs(c.lineY - c.my) * 0.45 + MARKER);
    c.endX = clamp(c.elbowX + c.side * length, 8, g.width - 8);
  }
  return callouts;
}

function GroupGuides({
  sectors,
  g,
  idPrefix,
  mode,
  hoveredGroup,
}: {
  sectors: GroupSector[];
  g: Geometry;
  idPrefix: string;
  mode: LabelMode;
  hoveredGroup: string | null;
}) {
  const R = g.radius;
  const showNames = R >= 90;
  const fontSize = clamp(R * 0.05, 9, 12);
  const multi = sectors.length > 1;
  return (
    <g aria-hidden="true">
      {sectors.map((s, i) => {
        const mid = ((s.angle % 360) + 360) % 360;
        const flip = mid > 90 && mid < 270;
        const inset = Math.min(3, (s.end - s.start) / 4);
        const rText = R * 0.9 - (flip ? 0 : fontSize * 0.75);
        const [ax, ay] = polar(g.cx, g.cy, rText, flip ? s.end - inset : s.start + inset);
        const [zx, zy] = polar(g.cx, g.cy, rText, flip ? s.start + inset : s.end - inset);
        const large = s.end - s.start - inset * 2 > 180 ? 1 : 0;
        const pathId = `${idPrefix}-g${i}`;
        const tick = (deg: number, from: number, opacity: number, key: string) => {
          const [x1, y1] = polar(g.cx, g.cy, R * from, deg);
          const [x2, y2] = polar(g.cx, g.cy, R * 0.975, deg);
          return (
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={1} opacity={opacity} />
          );
        };
        return (
          <g
            key={s.id}
            style={{ opacity: mode === "always" || hoveredGroup === s.id ? 1 : 0, transition: FADE }}
          >
            {multi && tick(s.start, 0.92, 0.4, "start")}
            {multi && tick(s.end, 0.92, 0.4, "end")}
            {s.classes.map((c) => tick(c.angle, 0.95, 0.25, c.id))}
            {showNames && (
              <>
                <path
                  id={pathId}
                  fill="none"
                  d={`M${ax},${ay} A${rText},${rText} 0 ${large} ${flip ? 0 : 1} ${zx},${zy}`}
                />
                <text
                  fill="currentColor"
                  opacity={0.5}
                  fontSize={fontSize}
                  fontWeight={600}
                  letterSpacing="0.22em"
                  textAnchor="middle"
                  style={{ textTransform: "uppercase" }}
                >
                  <textPath href={`#${pathId}`} startOffset="50%">
                    {s.label}
                  </textPath>
                </text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * A monochrome corona plot. Groups of anomaly classes are laid out around the
 * ring; each observed anomaly raises a flare at its class's slot, scaled by
 * its strength.
 */
export function Rehoboam({
  model,
  width,
  height,
  color,
  background,
  radius = 0.3,
  flareScale = 0.5,
  softness = 1,
  eclipseAngle = 280,
  startAngle,
  groupGap,
  groupSizing,
  anomalyLabels = "always",
  groupLabels = "always",
  maxLabels = 8,
  labelThreshold = 0,
  animate = true,
  speed = 1,
  formatLabel,
  onAnomalyClick,
  onAnomalyHover,
  className,
  style,
}: RehoboamProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const softRef = useRef<HTMLCanvasElement>(null);
  const sharpRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CoronaRenderer | null>(null);
  if (!rendererRef.current) rendererRef.current = new CoronaRenderer();
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<{ key: string | null; group: string | null }>({
    key: null,
    group: null,
  });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sectors = useMemo(
    () => computeLayout(model.groups, { startAngle, groupGap, groupSizing }),
    [model.groups, startAngle, groupGap, groupSizing],
  );
  const placed = useMemo(() => placeAnomalies(model.anomalies, sectors), [model.anomalies, sectors]);

  const geometry = useMemo<Geometry>(() => {
    const r = Math.min(size.w, size.h) * radius;
    return {
      width: size.w,
      height: size.h,
      cx: size.w / 2,
      cy: size.h / 2,
      radius: r,
      flareHeight: r * flareScale,
      heavyAngle: eclipseAngle * RAD,
    };
  }, [size, radius, flareScale, eclipseAngle]);

  const callouts = useMemo(() => {
    if (anomalyLabels === "never" || geometry.radius <= 0) return [];
    const format = formatLabel ?? defaultLabel;
    // On hover only one callout shows at a time, so each is laid out alone.
    if (anomalyLabels === "hover")
      return placed.flatMap((p) => layoutCallouts([p], geometry, 1, 0, format));
    return layoutCallouts(placed, geometry, maxLabels, labelThreshold, format);
  }, [anomalyLabels, placed, geometry, maxLabels, labelThreshold, formatLabel]);

  useEffect(() => {
    rendererRef.current!.setFlares(
      placed.map((p) => ({
        key: p.key,
        angle: p.angle * RAD,
        halfWidth: p.halfWidth * RAD,
        strength: p.strength,
      })),
    );
  }, [placed]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const softCanvas = softRef.current;
    const sharpCanvas = sharpRef.current;
    const soft = softCanvas?.getContext("2d");
    const sharp = sharpCanvas?.getContext("2d");
    if (!wrap || !softCanvas || !sharpCanvas || !soft || !sharp) return;
    if (geometry.width === 0 || geometry.height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const canvas of [softCanvas, sharpCanvas]) {
      canvas.width = Math.round(geometry.width * dpr);
      canvas.height = Math.round(geometry.height * dpr);
    }
    soft.setTransform(dpr, 0, 0, dpr, 0, 0);
    sharp.setTransform(dpr, 0, 0, dpr, 0, 0);

    const renderer = rendererRef.current!;
    const still =
      !animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    let ink = getComputedStyle(wrap).color;

    if (still) {
      renderer.draw(soft, sharp, geometry, ink, 0, Infinity, dpr);
      return;
    }

    let visible = true;
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(wrap);

    let raf = 0;
    let last = performance.now();
    let clock = 0;
    let frame = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!visible) return;
      clock += dt * speed;
      // Pick up theme changes when the colour is inherited.
      if (frame++ % 30 === 0) ink = getComputedStyle(wrap).color;
      renderer.draw(soft, sharp, geometry, ink, clock, dt, dpr);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
    // `placed` and `color` only matter here for the still frame.
  }, [geometry, animate, speed, placed, color]);

  /** What the pointer is over: a flare (or its callout) and a group's sector. */
  const hitTest = (e: ReactPointerEvent | React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap || geometry.radius <= 0) return { anomaly: null, group: null };
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left - geometry.cx;
    const y = e.clientY - rect.top - geometry.cy;
    const r = Math.hypot(x, y);
    const deg = (Math.atan2(x, -y) / RAD + 360) % 360;
    const R = geometry.radius;

    let group: GroupSector | null = null;
    if (r <= R * 1.15 + geometry.flareHeight)
      group =
        sectors.find((s) => (((deg - s.start) % 360) + 360) % 360 <= s.end - s.start) ?? null;

    const calloutKey = (e.target as Element).closest?.("[data-rehoboam-key]")?.getAttribute(
      "data-rehoboam-key",
    );
    let anomaly: PlacedAnomaly | null = null;
    if (calloutKey != null) {
      anomaly = placed.find((p) => p.key === calloutKey) ?? null;
    } else if (r >= R * 0.82) {
      let best = Infinity;
      for (const p of placed) {
        if (p.strength <= 0 || r > tipRadius(p, geometry) + 12) continue;
        const diff = Math.abs(((deg - p.angle + 540) % 360) - 180);
        if (diff <= Math.max(4, p.halfWidth * 0.6) && diff < best) {
          best = diff;
          anomaly = p;
        }
      }
    }
    return { anomaly, group: anomaly ? anomaly.group : group };
  };

  const onPointer = (e: ReactPointerEvent) => {
    const { anomaly, group } = hitTest(e);
    const key = anomaly?.key ?? null;
    const groupId = group?.id ?? null;
    if (key === hovered.key && groupId === hovered.group) return;
    setHovered({ key, group: groupId });
    if (key !== hovered.key) onAnomalyHover?.(anomaly?.anomaly ?? null);
  };
  const onLeave = () => {
    if (hovered.key !== null) onAnomalyHover?.(null);
    if (hovered.key !== null || hovered.group !== null) setHovered({ key: null, group: null });
  };

  const titleSize = clamp(geometry.width * 0.013, 10, 14);
  const canvasStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    display: "block",
  };
  const blur = Math.max(0, softness) * geometry.radius * 0.028;

  return (
    <div
      ref={wrapRef}
      className={className}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={onLeave}
      onClick={
        onAnomalyClick &&
        ((e) => {
          const { anomaly } = hitTest(e);
          if (anomaly) onAnomalyClick(anomaly.anomaly);
        })
      }
      style={{
        position: "relative",
        overflow: "hidden",
        width: width ?? "100%",
        height,
        aspectRatio: height == null ? "16 / 9" : undefined,
        color,
        background,
        cursor: onAnomalyClick && hovered.key !== null ? "pointer" : undefined,
        ...style,
      }}
    >
      <canvas
        ref={softRef}
        aria-hidden="true"
        style={{ ...canvasStyle, filter: blur > 0 ? `blur(${blur.toFixed(2)}px)` : undefined }}
      />
      <canvas ref={sharpRef} aria-hidden="true" style={canvasStyle} />
      {geometry.radius > 0 && (
        <svg
          role="img"
          aria-label={`Anomaly plot: ${placed.length} anomalies across ${sectors.length} groups`}
          width={geometry.width}
          height={geometry.height}
          style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
        >
          {groupLabels !== "never" && (
            <GroupGuides
              sectors={sectors}
              g={geometry}
              idPrefix={idPrefix}
              mode={groupLabels}
              hoveredGroup={hovered.group}
            />
          )}
          {callouts.map((c) => {
            const shown = anomalyLabels === "always" || hovered.key === c.placed.key;
            const dx = c.elbowX - c.mx;
            const dy = c.lineY - c.my;
            const len = Math.hypot(dx, dy) || 1;
            const sx = c.mx + (dx / len) * MARKER;
            const sy = c.my + (dy / len) * MARKER;
            // Start the text at the elbow, unless it would run off the edge.
            const textWidth =
              Math.max(c.label.title.length * 0.78, (c.label.subtitle?.length ?? 0) * 0.62) * titleSize;
            const room = c.side === 1 ? geometry.width - 8 - c.elbowX : c.elbowX - 8;
            const fits = textWidth + 8 <= room;
            const textX = fits ? c.elbowX + c.side * 8 : c.endX;
            const anchor = (c.side === 1) === fits ? "start" : "end";
            return (
              <g
                key={c.placed.key}
                data-rehoboam-key={c.placed.key}
                style={{
                  opacity: shown ? 1 : 0,
                  transition: FADE,
                  pointerEvents: shown ? "auto" : "none",
                }}
              >
                <polyline
                  points={`${sx},${sy} ${c.elbowX},${c.lineY} ${c.endX},${c.lineY}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1}
                  opacity={0.8}
                />
                <g transform={`translate(${c.mx},${c.my})`} stroke="currentColor" fill="none">
                  <polygon points={HEXAGON} strokeWidth={1.25} />
                  <circle r={3.75} strokeWidth={1} />
                  <circle r={1.5} fill="currentColor" stroke="none" />
                </g>
                <text
                  x={textX}
                  y={c.lineY - (c.label.subtitle ? titleSize + 9 : 7)}
                  textAnchor={anchor}
                  fill="currentColor"
                  fontSize={titleSize}
                  fontWeight={700}
                  letterSpacing="0.1em"
                  style={{ textTransform: "uppercase" }}
                >
                  {c.label.title}
                </text>
                {c.label.subtitle && (
                  <text
                    x={textX}
                    y={c.lineY - 6}
                    textAnchor={anchor}
                    fill="currentColor"
                    opacity={0.7}
                    fontSize={titleSize * 0.92}
                    letterSpacing="0.08em"
                  >
                    {c.label.subtitle}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
