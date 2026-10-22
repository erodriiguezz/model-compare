import { vendorColor } from "@/lib/vendor";
import type { Marker } from "@/lib/report";
import QualityScatter from "./QualityScatter";
import BarList from "./ui/BarList";

const usd = (v: number) => `$${v >= 10 ? v.toFixed(0) : v.toFixed(2)}`;
const secs = (v: number) => `${v.toFixed(1)} s`;

/** Cost per 1k tasks, what the run cost, and per-call latency (p50 solid, p95 as the lighter tail) next to quality vs latency. */
export default function CostSpeed({ markers, costs, slowestP95, vendors }: { markers: Record<string, Marker>; costs: Record<string, number>; slowestP95: Record<string, number>; vendors: Record<string, string> }) {
  const models = Object.keys(markers);
  const ran = models.filter((m) => markers[m].task_success != null && (markers[m].error_rate ?? 0) < 1); // no successful call means no real cost or latency
  const name = (m: string) => (markers[m].incomplete ? `${m} (incomplete)` : m);
  const cost = ran.flatMap((m) => { const v = markers[m].cost_per_1k_tasks; return v == null ? [] : [{ label: name(m), value: v, display: usd(v), color: markers[m].incomplete ? undefined : vendorColor(m), hatched: markers[m].incomplete }]; })
    .sort((a, b) => a.value - b.value);
  const lat = ran.flatMap((m) => { const v = markers[m].latency_p50; return v == null ? [] : [{ m, p50: v, p95: slowestP95[m] as number | undefined }]; }).sort((a, b) => a.p50 - b.p50);
  const maxLat = Math.max(...lat.map((l) => l.p95 ?? l.p50), 0) || 1;
  const spent = models.flatMap((m) => (costs[m] == null ? [] : [m]));
  return (
    <>
      <section id="cost" className="report-section" aria-labelledby="cost-h">
        <h2 id="cost-h" className="sec">Cost</h2>
        <div className="split">
          <section className="card" aria-labelledby="cost1k-h">
            <h3 id="cost1k-h">Cost per 1,000 tasks <span className="muted small">Lower is better</span></h3>
            <p className="muted small">Tokens at list price, averaged over every case. Cheapest first.</p>
            <BarList label="Cost per 1,000 tasks" items={cost} />
          </section>
          <section className="card" aria-labelledby="spend-h">
            <h3 id="spend-h">What this run cost</h3>
            <p className="muted small">Actual spend for this report. Cached calls are free.</p>
            <div className="stat-tile"><span className="muted small">Total spend</span><strong className="stat-big">{usd(spent.reduce((a, m) => a + costs[m], 0))}</strong></div>
            <ul className="spend" aria-label="Spend by model">
              {spent.map((m) => <li key={m}><span><span className="dot" style={{ background: vendorColor(m) }} /> {m}</span><strong>{usd(costs[m])}</strong></li>)}
            </ul>
          </section>
        </div>
      </section>
      <section id="speed" className="report-section" aria-labelledby="speed-h">
        <h2 id="speed-h" className="sec">Speed</h2>
        <div className="split">
          <section className="card" aria-labelledby="latency-h">
            <h3 id="latency-h">Latency per call <span className="muted small">Lower is better</span></h3>
            <p className="muted small">Solid bar: median (p50). Lighter extension: the slow tail (p95, from the slowest benchmark). Fastest first.</p>
            <ul className="barlist latency" aria-label="Latency per call">
              {lat.map((l) => (
                <li key={l.m}>
                  <span>{name(l.m)}</span>
                  <span className="track">
                    {l.p95 != null && <span className={markers[l.m].incomplete ? "fill tail hatched" : "fill tail"} style={{ width: `${(100 * l.p95) / maxLat}%`, background: markers[l.m].incomplete ? undefined : vendorColor(l.m) }} />}
                    <span className={markers[l.m].incomplete ? "fill hatched" : "fill"} style={{ width: `${(100 * l.p50) / maxLat}%`, background: markers[l.m].incomplete ? undefined : vendorColor(l.m) }} />
                  </span>
                  <span className="value">{secs(l.p50)}{l.p95 != null && <span className="muted small"> · p95 {secs(l.p95)}</span>}</span>
                </li>
              ))}
            </ul>
          </section>
          <QualityScatter markers={markers} vendors={vendors} x="latency" />
        </div>
      </section>
    </>
  );
}
