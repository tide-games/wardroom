// merge-states.js — fold parallel workers' MCCFR deltas back into one state.
//   node merge-states.js <base> <out> <worker1> [worker2 ...]
// merged = base + Σ(worker − base); regrets re-floored at 0 (the RM+
// invariant the trainer maintains). Additivity is exact for regret sums
// and a benign approximation for the linearly-weighted strategy average.
import fs from 'node:fs';

const [base, out, ...workers] = process.argv.slice(2);
if (!base || !out || !workers.length) {
  console.error('usage: node merge-states.js <base> <out> <worker...>');
  process.exit(1);
}
const load = (p) => {
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    regret: new Map(st.regret.map(([k, v]) => [k, Float64Array.from(v)])),
    strategySum: new Map(st.strategySum.map(([k, v]) => [k, Float64Array.from(v)])),
    iterationsDone: st.iterationsDone,
  };
};
const B = load(base);
const mergedR = new Map(), mergedS = new Map();
for (const [k, v] of B.regret) mergedR.set(k, Float64Array.from(v));
for (const [k, v] of B.strategySum) mergedS.set(k, Float64Array.from(v));
let iters = B.iterationsDone;

for (const wp of workers) {
  const W = load(wp);
  iters += W.iterationsDone - B.iterationsDone;
  for (const [k, wv] of W.regret) {
    const bv = B.regret.get(k);
    let m = mergedR.get(k);
    if (!m) { m = new Float64Array(wv.length); mergedR.set(k, m); }
    for (let i = 0; i < wv.length; i++) m[i] += wv[i] - (bv ? bv[i] : 0);
  }
  for (const [k, wv] of W.strategySum) {
    const bv = B.strategySum.get(k);
    let m = mergedS.get(k);
    if (!m) { m = new Float64Array(wv.length); mergedS.set(k, m); }
    for (let i = 0; i < wv.length; i++) m[i] += wv[i] - (bv ? bv[i] : 0);
  }
  console.log(`folded ${wp}: +${(W.iterationsDone - B.iterationsDone).toLocaleString()} iters`);
}
for (const v of mergedR.values()) for (let i = 0; i < v.length; i++) if (v[i] < 0) v[i] = 0;

fs.writeFileSync(out, JSON.stringify({
  iterationsDone: iters,
  regret: [...mergedR.entries()].map(([k, v]) => [k, [...v]]),
  strategySum: [...mergedS.entries()].map(([k, v]) => [k, [...v]]),
}));
console.log(`merged: ${iters.toLocaleString()} iterations, ${mergedR.size.toLocaleString()} infosets → ${out}`);
