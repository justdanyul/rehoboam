const TAU = Math.PI * 2;
const SAMPLES = 720;
const LAYERS = 5;

export interface Flare {
  key: string;
  /** Radians, 0 at twelve o'clock, clockwise. */
  angle: number;
  /** Radians. */
  halfWidth: number;
  strength: number;
}

export interface Geometry {
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Radius of the clear inner disc. */
  radius: number;
  /** Height of a strength-1 flare. */
  flareHeight: number;
  /** Direction of the heavy, eclipsed side. Radians, 0 at twelve o'clock, clockwise. */
  heavyAngle: number;
}

/** Thickness of the thin ring. */
export const bandWidth = (radius: number) => radius * 0.012;

/** Extra thickness of the dark crescent at `angle`, on the heavy side. */
export function swellAt(radius: number, angle: number, heavyAngle: number): number {
  const c = Math.cos(angle - heavyAngle);
  return c > 0 ? radius * 0.11 * Math.pow(c, 1.5) : 0;
}

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

/**
 * Value noise that is linear around the ring (so it reads as jagged peaks),
 * periodic over `cells`, and eased through time.
 */
function jag(seed: number, u: number, cells: number, t: number): number {
  const x = u * cells;
  const i = Math.floor(x);
  const f = x - i;
  const ts = Math.floor(t);
  let tf = t - ts;
  tf = tf * tf * (3 - 2 * tf);
  const i0 = i % cells;
  const i1 = (i + 1) % cells;
  const a = hash(seed, i0, ts) * (1 - tf) + hash(seed, i0, ts + 1) * tf;
  const b = hash(seed, i1, ts) * (1 - tf) + hash(seed, i1, ts + 1) * tf;
  return a + (b - a) * f;
}

interface FlareState {
  angle: number;
  halfWidth: number;
  current: number;
  target: number;
  seed: number;
}

/**
 * Draws the corona onto two stacked canvases: `soft` holds the smoke (the
 * caller blurs that canvas with CSS), `sharp` holds the thin ring and spikes.
 * Holds only the eased flare strengths.
 */
export class CoronaRenderer {
  private flares = new Map<string, FlareState>();
  private envelope = new Float32Array(SAMPLES);
  private base = new Float32Array(SAMPLES);
  private profile = new Float32Array(SAMPLES);

  setFlares(next: Flare[]): void {
    const seen = new Set<string>();
    for (const f of next) {
      seen.add(f.key);
      const state = this.flares.get(f.key);
      if (state) {
        state.angle = f.angle;
        state.halfWidth = f.halfWidth;
        state.target = f.strength;
      } else {
        this.flares.set(f.key, {
          angle: f.angle,
          halfWidth: f.halfWidth,
          current: 0,
          target: f.strength,
          seed: hashString(f.key),
        });
      }
    }
    for (const [key, state] of this.flares) if (!seen.has(key)) state.target = 0;
  }

  /**
   * @param t  animation clock in seconds
   * @param dt seconds since the last frame; pass Infinity to snap flares to their targets
   */
  draw(
    soft: CanvasRenderingContext2D,
    sharp: CanvasRenderingContext2D,
    g: Geometry,
    color: string,
    t: number,
    dt: number,
    dpr: number,
  ): void {
    const { cx, cy, radius: R, flareHeight: H, heavyAngle: phi } = g;
    for (const ctx of [soft, sharp]) {
      ctx.clearRect(0, 0, g.width, g.height);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 0;
      ctx.lineCap = "round";
    }
    if (R <= 0) return;

    // Ease flare strengths and accumulate them into an angular envelope.
    const ease = 1 - Math.exp(-dt * 3.5);
    const env = this.envelope;
    env.fill(0);
    for (const [key, f] of this.flares) {
      f.current += (f.target - f.current) * ease;
      if (f.target === 0 && f.current < 0.003) {
        this.flares.delete(key);
        continue;
      }
      const centre = (f.angle / TAU) * SAMPLES;
      const half = Math.max(1, (f.halfWidth / TAU) * SAMPLES);
      for (let i = Math.ceil(centre - half); i <= centre + half; i++) {
        const x = Math.abs(i - centre) / half;
        // A sharp central spike on a wider skirt.
        const bump = 0.7 * Math.pow(1 - x, 2.6) + 0.3 * (1 - x);
        env[((i % SAMPLES) + SAMPLES) % SAMPLES] += f.current * bump;
      }
    }

    const w = bandWidth(R);
    const base = this.base;
    for (let k = 0; k < SAMPLES; k++) base[k] = R + w + swellAt(R, (k / SAMPLES) * TAU, phi);

    /** Low roughness and the odd prominence, all the way round. */
    const rough = (layer: number, u: number) =>
      R * 0.01 * jag(layer * 13 + 3, u, 180, t * 0.4 + layer) +
      R * 0.03 * Math.max(0, jag(999, u, 20, t * 0.12) - 0.62) * 2.6;

    const flareProfile = (layer: number) => {
      const prof = this.profile;
      const scale = 0.86 - layer * 0.12;
      for (let k = 0; k < SAMPLES; k++) {
        const u = k / SAMPLES;
        const n =
          0.65 * jag(layer * 13 + 1, u, 120, t * 0.5 + layer * 0.37) +
          0.35 * jag(layer * 13 + 2, u, 300, t * 0.9 + layer * 0.11);
        const e = Math.min(env[k], 1.2);
        // Layer 0 is the steady outer silhouette; the inner layers spread
        // wider and rougher around its base.
        prof[k] =
          base[k] +
          rough(layer, u) +
          (layer === 0
            ? e * H * (0.72 + 0.28 * n)
            : Math.pow(e, 0.62) * H * scale * (0.12 + 0.88 * Math.pow(n, 1.3)));
      }
      return prof;
    };

    /** Fills between a radial profile and the disc edge. */
    const fillRing = (ctx: CanvasRenderingContext2D, radii: Float32Array) => {
      ctx.beginPath();
      for (let k = 0; k < SAMPLES; k++) {
        const th = (k / SAMPLES) * TAU;
        const x = cx + radii[k] * Math.sin(th);
        const y = cy - radii[k] * Math.cos(th);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.moveTo(cx + R, cy);
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill("evenodd");
    };

    // ---- Soft canvas: smoke ------------------------------------------------

    // The dark crescent. Its shadow bleeds outwards and into the disc.
    soft.shadowBlur = R * 0.22 * dpr;
    soft.globalAlpha = 0.85;
    fillRing(soft, base);
    soft.globalAlpha = 0.5;
    fillRing(soft, base);
    soft.shadowBlur = 0;

    // Radial streaks raking out of the heavy side.
    soft.globalAlpha = 0.28;
    for (let i = 0; i < 18; i++) {
      const offset = (hash(77, i, 0) - 0.5) * 1.5;
      const c = Math.cos(offset);
      const th = phi + offset;
      const len =
        R * (0.1 + 0.4 * hash(77, i, 1)) * c * c * (0.6 + 0.4 * jag(500 + i, 0, 1, t * 0.3));
      const r1 = R + w + swellAt(R, th, phi) + len;
      soft.lineWidth = R * (0.006 + 0.012 * hash(77, i, 2));
      soft.beginPath();
      soft.moveTo(cx + R * Math.sin(th), cy - R * Math.cos(th));
      soft.lineTo(cx + r1 * Math.sin(th), cy - r1 * Math.cos(th));
      soft.stroke();
    }

    // Flare silhouettes, stacked translucently; the outermost carries a halo.
    soft.shadowBlur = R * 0.3 * dpr;
    soft.globalAlpha = 0.34;
    fillRing(soft, flareProfile(0));
    soft.shadowBlur = 0;
    soft.globalAlpha = 0.3;
    for (let layer = 1; layer < LAYERS; layer++) fillRing(soft, flareProfile(layer));

    // ---- Sharp canvas: ring, texture, spikes -------------------------------

    // A little crisp texture at the base of the flares.
    sharp.globalAlpha = 0.16;
    fillRing(sharp, flareProfile(1));
    sharp.globalAlpha = 0.24;
    fillRing(sharp, flareProfile(LAYERS - 1));

    // The thin ring.
    const prof = this.profile;
    for (let k = 0; k < SAMPLES; k++) prof[k] = R + w + rough(1, k / SAMPLES);
    sharp.globalAlpha = 0.75;
    fillRing(sharp, prof);

    // A hairline spike per flare, plus a few shorter hairs around it.
    const spike = (angle: number, halfBase: number, tip: number, tilt: number) => {
      sharp.beginPath();
      sharp.moveTo(cx + R * Math.sin(angle - halfBase), cy - R * Math.cos(angle - halfBase));
      sharp.lineTo(cx + tip * Math.sin(angle + tilt), cy - tip * Math.cos(angle + tilt));
      sharp.lineTo(cx + R * Math.sin(angle + halfBase), cy - R * Math.cos(angle + halfBase));
      sharp.fill();
    };
    for (const f of this.flares.values()) {
      const foot = R + w + swellAt(R, f.angle, phi);
      sharp.globalAlpha = 0.7;
      spike(f.angle, Math.min(0.02, Math.max(0.007, f.halfWidth * 0.1)), foot + f.current * H, 0);
      sharp.globalAlpha = 0.5;
      for (let j = 0; j < 4; j++) {
        const a = f.angle + (hash(f.seed, j, 1) - 0.5) * 1.5 * f.halfWidth;
        const height =
          f.current *
          H *
          (0.2 + 0.45 * hash(f.seed, j, 2)) *
          (0.75 + 0.25 * jag(f.seed & 0xffff, 0, 1, t * 0.6 + j));
        spike(a, 0.006, R + w + swellAt(R, a, phi) + height, (hash(f.seed, j, 3) - 0.5) * 0.03);
      }
    }

    soft.globalAlpha = 1;
    sharp.globalAlpha = 1;
  }
}
