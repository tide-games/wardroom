// train-holdem.js — external-sampling MCCFR for abstracted heads-up
// fixed-limit hold'em. run: node train-holdem.js [iterations] [checkpoint]
// Checkpoints let runs accumulate: state saves to train-state.json and the
// shipped table exports to strategy-hulimit.json (pruned + quantized).
import fs from 'node:fs';
import { HU, setEquityEdges } from './ladder.js';

const EQ = process.argv.includes('eq');
if (EQ) {
  setEquityEdges(JSON.parse(fs.readFileSync('buckets-eq.json', 'utf8')));
  console.log('equity abstraction armed: EHS2 percentile buckets on flop/turn');
}

const ITERS = Number(process.argv[2] || 1_000_000);
const STATE_FILE = EQ ? 'train-state-eq.json' : (process.argv[3] || 'train-state.json');
const OUT_FILE = EQ ? 'strategy-eq.json' : 'strategy-hulimit.json';

const regret = new Map();
const strategySum = new Map();
let iterationsDone = 0;

if (fs.existsSync(STATE_FILE)) {
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  for (const [k, v] of st.regret) regret.set(k, Float64Array.from(v));
  for (const [k, v] of st.strategySum) strategySum.set(k, Float64Array.from(v));
  iterationsDone = st.iterationsDone;
  console.log(`resumed: ${iterationsDone.toLocaleString()} iterations, ${regret.size.toLocaleString()} infosets`);
}

const get = (map, key, n) => {
  let v = map.get(key);
  if (!v) { v = new Float64Array(n); map.set(key, v); }
  return v;
};
function matched(key, n) {
  const r = get(regret, key, n);
  let sum = 0;
  const s = new Array(n);
  for (let i = 0; i < n; i++) { s[i] = r[i] > 0 ? r[i] : 0; sum += s[i]; }
  if (sum > 0) { for (let i = 0; i < n; i++) s[i] /= sum; } else s.fill(1 / n);
  return s;
}

const deck = Array.from({ length: 52 }, (_, i) => i);
function deal() {
  for (let i = 0; i < 9; i++) {
    const j = i + ((Math.random() * (52 - i)) | 0);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return { holes: [[deck[0], deck[1]], [deck[2], deck[3]]], board: deck.slice(4, 9) };
}

// external-sampling MCCFR traversal for `traverser`; `w` is the linear
// averaging weight (CFR+): later iterations dominate the average strategy
let avgWeight = 1;
function traverse(st, holes, board, traverser) {
  if (st.done) {
    const u = HU.utility(st, holes, board);
    return traverser === 0 ? u : -u;
  }
  const acts = HU.actions(st);
  const key = HU.infoset(st, holes[st.actor], board);
  const strat = matched(key, acts.length);
  if (st.actor === traverser) {
    const utils = new Array(acts.length);
    let nodeUtil = 0;
    for (let a = 0; a < acts.length; a++) {
      utils[a] = traverse(HU.apply(st, acts[a]), holes, board, traverser);
      nodeUtil += strat[a] * utils[a];
    }
    const r = get(regret, key, acts.length);
    for (let a = 0; a < acts.length; a++) r[a] = Math.max(0, r[a] + utils[a] - nodeUtil);   // RM+
    return nodeUtil;
  }
  // opponent: sample one action, accumulate their average strategy
  const ss = get(strategySum, key, acts.length);
  for (let a = 0; a < acts.length; a++) ss[a] += avgWeight * strat[a];
  let x = Math.random(), pick = acts.length - 1;
  for (let a = 0; a < acts.length; a++) { x -= strat[a]; if (x <= 0) { pick = a; break; } }
  return traverse(HU.apply(st, acts[pick]), holes, board, traverser);
}

const t0 = Date.now();
const report = Math.max(1, Math.floor(ITERS / 10));
for (let i = 0; i < ITERS; i++) {
  const { holes, board } = deal();
  avgWeight = (iterationsDone + i) / 1e6 + 1;      // linear averaging, scaled
  traverse(HU.initial(), holes, board, i % 2);
  if ((i + 1) % report === 0) {
    const rate = ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(0);
    console.log(`${(i + 1).toLocaleString()}/${ITERS.toLocaleString()}  ${regret.size.toLocaleString()} infosets  ${rate} it/s`);
  }
}
iterationsDone += ITERS;

// checkpoint
fs.writeFileSync(STATE_FILE, JSON.stringify({
  iterationsDone,
  regret: [...regret.entries()].map(([k, v]) => [k, [...v]]),
  strategySum: [...strategySum.entries()].map(([k, v]) => [k, [...v]]),
}));

// export the shipped table: average strategy, pruned and quantized
let kept = 0, dropped = 0;
const table = {};
for (const [k, ss] of strategySum) {
  const sum = ss.reduce((a, b) => a + b, 0);
  if (sum < 10) { dropped++; continue; }              // barely-visited: fall back to uniform at play
  const probs = [...ss].map((x) => Math.round((x / sum) * 255) / 255);
  const norm = probs.reduce((a, b) => a + b, 0);
  table[k] = probs.map((p) => +(p / norm).toFixed(4));
  kept++;
}
const meta = { iterations: iterationsDone, infosets: kept, table };
if (EQ) { meta.abstraction = 'ehs2-800-v1'; meta.edges = JSON.parse(fs.readFileSync('buckets-eq.json', 'utf8')); }
fs.writeFileSync(OUT_FILE, JSON.stringify(meta));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\ndone: +${ITERS.toLocaleString()} iterations (${iterationsDone.toLocaleString()} total) in ${secs}s`);
console.log(`infosets: ${regret.size.toLocaleString()} seen, ${kept.toLocaleString()} exported, ${dropped.toLocaleString()} pruned`);
console.log(`table: ${OUT_FILE} ${(fs.statSync(OUT_FILE).size / 1e6).toFixed(1)}MB, state: ${STATE_FILE} ${(fs.statSync(STATE_FILE).size / 1e6).toFixed(1)}MB`);
