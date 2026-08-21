// prune-nl.js — slim a trained NL state into a browser-sized strategy table.
// Works from the STATE file (the emitted table has already lost visit info):
// keeps only infosets with enough visit mass, zeroes near-noise actions,
// and stores probabilities at 3 decimals. Everything dropped falls back to
// uniform at play — cheap exactly where visits were rare.
//
//   NODE_OPTIONS=--max-old-space-size=16384 node prune-nl.js \
//     [state=train-state-nl.json] [out=strategy-nl-slim.json] [minVisits=20000] [epsAction=0.02]
//
// Always duel the slim table against the full one (ab-nl.js) before shipping:
// the visit-mass histogram says what you kept, only a duel says what it cost.
import fs from 'node:fs';

const STATE = process.argv[2] || 'train-state-nl.json';
const OUT = process.argv[3] || 'strategy-nl-slim.json';
const MIN_VISITS = Number(process.argv[4] || 20000);
const EPS_ACTION = Number(process.argv[5] || 0.02);

const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
let kept = 0, dropped = 0, massKept = 0, massTotal = 0;
const table = {};
for (const [k, ss] of st.strategySum) {
  const sum = ss.reduce((a, b) => a + b, 0);
  massTotal += sum;
  if (sum < MIN_VISITS) { dropped++; continue; }
  massKept += sum;
  let probs = ss.map((x) => x / sum);
  probs = probs.map((p) => (p < EPS_ACTION ? 0 : p));      // shed noise actions
  const norm = probs.reduce((a, b) => a + b, 0) || 1;
  table[k] = probs.map((p) => +(p / norm).toFixed(3));
  kept++;
}
const meta = {
  iterations: st.iterationsDone,
  infosets: kept,
  pruned: { minVisits: MIN_VISITS, epsAction: EPS_ACTION, dropped, visitMassKept: +(massKept / massTotal).toFixed(4) },
  abstraction: 'hunl-ehs2-3size-v0',
  edges: JSON.parse(fs.readFileSync('buckets-eq.json', 'utf8')),
  table,
};
fs.writeFileSync(OUT, JSON.stringify(meta));
const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`kept ${kept.toLocaleString()} / dropped ${dropped.toLocaleString()} infosets · ${(massKept / massTotal * 100).toFixed(2)}% of visit mass · ${OUT} ${mb}MB`);
