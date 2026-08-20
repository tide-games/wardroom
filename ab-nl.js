// ab-nl.js — duel two HUNL strategy tables in the abstract game.
//   node ab-nl.js <tableA.json|random> <tableB.json|random> [hands=40000]
// Seats alternate; result is A's earnings in bb/100.
import fs from 'node:fs';
import { HUNL } from './hunl.js';
import { setEquityEdges } from './ladder.js';

const load = (p) => p === 'random' ? null : JSON.parse(fs.readFileSync(p, 'utf8'));
const A = load(process.argv[2]), B = load(process.argv[3]);
const N = Number(process.argv[4] || 40000);
setEquityEdges((A?.edges) || (B?.edges) || JSON.parse(fs.readFileSync('buckets-eq.json', 'utf8')));

const deck = Array.from({ length: 52 }, (_, i) => i);
let seed = 1234567;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
const BOARD_N = [0, 3, 4, 5];

function decide(table, st, hole, board) {
  const acts = HUNL.actions(st);
  let probs = null;
  if (table) {
    const key = HUNL.infoset(st, hole, board.slice(0, BOARD_N[st.street]));
    const row = table.table[key];
    if (row && row.length === acts.length) probs = row;
  }
  if (!probs) probs = acts.map(() => 1 / acts.length);
  let x = rng(), pick = acts.length - 1;
  for (let i = 0; i < acts.length; i++) { x -= probs[i]; if (x <= 0) { pick = i; break; } }
  return acts[pick];
}

let net = 0;
for (let n = 0; n < N; n++) {
  const d = [...deck];
  for (let i = 0; i < 9; i++) { const j = i + ((rng() * (52 - i)) | 0); [d[i], d[j]] = [d[j], d[i]]; }
  const holes = [[d[0], d[1]], [d[2], d[3]]], board = d.slice(4, 9);
  const aSeat = n % 2;                  // A alternates button
  let st = HUNL.initial(), guard = 0;
  while (!st.done && guard++ < 60) {
    const t = st.actor === aSeat ? A : B;
    st = HUNL.apply(st, decide(t, st, holes[st.actor], board));
  }
  const u0 = HUNL.utility(st, holes, board);
  net += aSeat === 0 ? u0 : -u0;
}
const bb100 = net / 2 / N * 100;      // units: bb = 2
console.log(`A earns ${bb100 >= 0 ? '+' : ''}${bb100.toFixed(1)} bb/100 over ${N.toLocaleString()} hands`);
