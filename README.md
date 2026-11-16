# rehoboam

A monochrome corona plot, as a React component. Groups of anomaly
classes are laid out around a ring; each observed "anomaly" raises a flare at its
class's position, scaled by its strength.

The look is inspired by a sci-fi TV show, in which a plot like this tracked
anomalies on a global scale: a calm, eclipse-like disc whose corona flares up
wherever the world drifts from what was predicted.

The API talks about anomalies, but it doesn't have to be about anomalies.
Anything that sorts into groups and classes and has a 0–1 intensity can go on
the ring: alert volume per service, sentiment per topic, traffic per region,
load per subsystem. Read "anomaly" as "signal".

## Install

Install straight from GitHub. npm builds the package on install, so there is
nothing to publish:

```bash
npm install github:justdanyul/rehoboam
```

Pin a branch, tag or commit by adding it after `#`:

```bash
npm install github:justdanyul/rehoboam#v0.1.0
```

React 18 or newer is a peer dependency and must already be in your project.

Recent npm versions warn that `rehoboam` has a `prepare` install script; that
script is the build step. Run `npm install-scripts approve rehoboam` to
silence the warning.

## Usage

```tsx
import { Rehoboam, type RehoboamModel } from "rehoboam";

const model: RehoboamModel = {
  groups: [
    {
      id: "cooling",
      label: "Cooling",
      classes: [
        { id: "inlet", label: "Inlet temperature" },
        { id: "humidity", label: "Humidity" },
      ],
    },
    {
      id: "network",
      label: "Network",
      classes: [
        { id: "latency", label: "Latency" },
        { id: "loss", label: "Packet loss" },
      ],
    },
  ],
  anomalies: [
    { id: "a1", groupId: "cooling", classId: "inlet", strength: 0.6, detail: "Rack inlet : 29.8 °C" },
    { id: "a2", groupId: "network", classId: "latency", strength: 0.3 },
  ],
};

<Rehoboam model={model} color="#161616" background="#f1f1f1" />;
```

## Model

- **groups** — G groups, placed clockwise in order. Each owns one sector of the ring.
- **classes** — the N classes of a group split its sector into equal slots.
- **anomalies** — each names a `groupId` and `classId` and has a `strength` from 0 to 1.
  Several anomalies of the same class share that class's slot. Give anomalies a
  stable `id` so flares ease between model updates rather than restarting.

## Props

| Prop | Default | |
| --- | --- | --- |
| `model` | — | The groups and anomalies. |
| `color` | inherited CSS `color` | The single ink colour; every shade is an opacity of it. |
| `background` | transparent | |
| `width`, `height` | `100%`, 16:9 | CSS sizes. |
| `radius` | `0.3` | Disc radius as a fraction of the smaller side. |
| `flareScale` | `0.5` | Height of a strength-1 flare, as a fraction of the radius. |
| `startAngle` | `0` | Degrees clockwise from twelve o'clock where the first group starts. |
| `groupGap` | `6` | Degrees of empty ring between groups. |
| `groupSizing` | `"equal"` | `"proportional"` sizes sectors by class count. |
| `anomalyLabels` | `"always"` | Anomaly callouts: `"always"`, `"hover"` (while the pointer is over the flare) or `"never"`. |
| `groupLabels` | `"always"` | Group names and class ticks inside the disc: `"always"`, `"hover"` (while the pointer is over the sector) or `"never"`. |
| `maxLabels`, `labelThreshold` | `8`, `0` | With `anomalyLabels="always"`, which anomalies get a callout. |
| `softness` | `1` | How blurred the smoke is; `0` is crisp. |
| `eclipseAngle` | `280` | Direction of the heavy side, degrees clockwise from twelve o'clock. |
| `formatLabel` | `GROUP: CLASS` / `detail` | Returns `{ title, subtitle }` for a callout. |
| `animate`, `speed` | `true`, `1` | Animation is always off under `prefers-reduced-motion`. |
| `onAnomalyClick`, `onAnomalyHover` | — | Fired from flares and their callouts. |

`computeLayout` and `placeAnomalies` are exported too, if you need the angles.

## Develop

```bash
npm run dev     # demo at http://localhost:5173
npm run build   # library bundle and types in dist/
```

## License

[MIT](LICENSE)
