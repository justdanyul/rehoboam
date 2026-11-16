import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Rehoboam, type Anomaly, type AnomalyGroup, type LabelMode } from "../src";

const MODES: LabelMode[] = ["always", "hover", "never"];
const nextMode = (m: LabelMode) => MODES[(MODES.indexOf(m) + 1) % MODES.length];

/**
 * A data center: each class has a metric that reads normal at strength 0 and
 * critical at strength 1, so the demo can write a plausible callout for any
 * strength.
 */
interface Metric {
  label: string;
  name: string;
  unit: string;
  normal: number;
  critical: number;
  digits?: number;
}

const metrics: Record<string, { label: string; classes: Record<string, Metric> }> = {
  cooling: {
    label: "Cooling",
    classes: {
      inlet: { label: "Inlet temperature", name: "Rack inlet", unit: "°C", normal: 22, critical: 35, digits: 1 },
      hotaisle: { label: "Hot aisle", name: "Hot aisle", unit: "°C", normal: 35, critical: 50, digits: 1 },
      crac: { label: "CRAC unit", name: "Airflow", unit: "%", normal: 100, critical: 40 },
      humidity: { label: "Humidity", name: "Rel. humidity", unit: "%", normal: 45, critical: 75 },
    },
  },
  power: {
    label: "Power",
    classes: {
      ups: { label: "UPS", name: "UPS runtime", unit: "min", normal: 30, critical: 4 },
      pdu: { label: "PDU load", name: "PDU load", unit: "%", normal: 55, critical: 98 },
      pue: { label: "Efficiency", name: "PUE", unit: "", normal: 1.3, critical: 2.1, digits: 2 },
    },
  },
  network: {
    label: "Network",
    classes: {
      latency: { label: "Latency", name: "p99 latency", unit: "ms", normal: 2, critical: 180, digits: 1 },
      loss: { label: "Packet loss", name: "Packet loss", unit: "%", normal: 0, critical: 8, digits: 2 },
      links: { label: "Link flaps", name: "Flaps / h", unit: "", normal: 0, critical: 40 },
      egress: { label: "Egress", name: "Uplink use", unit: "%", normal: 40, critical: 99 },
    },
  },
  compute: {
    label: "Compute",
    classes: {
      cpu: { label: "CPU saturation", name: "Cluster CPU", unit: "%", normal: 50, critical: 99 },
      memory: { label: "Memory pressure", name: "OOM kills / h", unit: "", normal: 0, critical: 120 },
      disk: { label: "Disk health", name: "Failing disks", unit: "", normal: 0, critical: 24 },
      nodes: { label: "Node availability", name: "Nodes down", unit: "", normal: 0, critical: 60 },
    },
  },
  security: {
    label: "Security",
    classes: {
      auth: { label: "Auth failures", name: "Failed logins / min", unit: "", normal: 2, critical: 900 },
      access: { label: "Physical access", name: "Badge denials", unit: "", normal: 0, critical: 30 },
      ddos: { label: "Traffic surge", name: "Inbound", unit: "Gbit/s", normal: 4, critical: 400 },
    },
  },
};

const groups: AnomalyGroup[] = Object.entries(metrics).map(([id, g]) => ({
  id,
  label: g.label,
  classes: Object.entries(g.classes).map(([cid, c]) => ({ id: cid, label: c.label })),
}));

function reading(groupId: string, classId: string, strength: number): string {
  const m = metrics[groupId].classes[classId];
  const value = (m.normal + (m.critical - m.normal) * strength).toFixed(m.digits ?? 0);
  return `${m.name} : ${value}${m.unit ? ` ${m.unit}` : ""}`;
}

const anomaly = (id: string, groupId: string, classId: string, strength: number): Anomaly => ({
  id,
  groupId,
  classId,
  strength,
  detail: reading(groupId, classId, strength),
});

const seed: Anomaly[] = [
  anomaly("a1", "cooling", "inlet", 0.62),
  anomaly("a2", "cooling", "crac", 0.4),
  anomaly("a3", "power", "pdu", 0.5),
  anomaly("a4", "network", "latency", 0.35),
  anomaly("a5", "compute", "disk", 0.25),
  anomaly("a6", "security", "auth", 0.85),
];

let nextId = 100;
function randomAnomalies(): Anomaly[] {
  const out: Anomaly[] = [];
  for (const g of groups)
    for (const c of g.classes)
      if (Math.random() < 0.4) out.push(anomaly(`r${nextId++}`, g.id, c.id, 0.15 + Math.random() * 0.85));
  return out;
}

function App() {
  const [dark, setDark] = useState(false);
  const [anomalies, setAnomalies] = useState(seed);
  const [live, setLive] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [anomalyLabels, setAnomalyLabels] = useState<LabelMode>("always");
  const [groupLabels, setGroupLabels] = useState<LabelMode>("always");

  // Let strengths wander, to show flares easing between model updates.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      setAnomalies((list) =>
        list.map((a) =>
          anomaly(
            a.id!,
            a.groupId,
            a.classId,
            Math.min(1, Math.max(0.1, a.strength + (Math.random() - 0.5) * 0.35)),
          ),
        ),
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [live]);

  const button = {
    font: "inherit",
    fontSize: 12,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    padding: "6px 12px",
    color: "inherit",
    background: "transparent",
    border: "1px solid currentColor",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        color: dark ? "#f2f2f2" : "#161616",
        background: dark ? "#060606" : "#f1f1f1",
      }}
    >
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "14px 18px" }}>
        <div style={{ marginRight: "auto" }}>
          <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: "0.12em" }}>REHOBOAM</div>
          <div style={{ fontSize: 12, opacity: 0.65, letterSpacing: "0.06em" }}>
            {picked ?? `Data center DC-01 · ${anomalies.length} anomalies observed`}
          </div>
        </div>
        <button style={button} onClick={() => setAnomalyLabels(nextMode)}>Callouts: {anomalyLabels}</button>
        <button style={button} onClick={() => setGroupLabels(nextMode)}>Groups: {groupLabels}</button>
        <button style={button} onClick={() => setAnomalies(randomAnomalies())}>Randomise</button>
        <button style={button} onClick={() => setAnomalies(seed)}>Reset</button>
        <button style={button} onClick={() => setLive((v) => !v)}>{live ? "Stop drift" : "Drift"}</button>
        <button style={button} onClick={() => setDark((v) => !v)}>{dark ? "Light" : "Dark"}</button>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Rehoboam
          model={{ groups, anomalies }}
          height="100%"
          groupSizing="proportional"
          anomalyLabels={anomalyLabels}
          groupLabels={groupLabels}
          onAnomalyClick={(a) => setPicked(`Selected: ${a.groupId} / ${a.classId}`)}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
