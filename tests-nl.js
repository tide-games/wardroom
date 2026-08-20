// tests-nl.js — fuzz the HUNL abstract tree before a single CFR iteration
// trusts it: invariants over random playouts, then determinism.
import { HUNL } from './hunl.js';
import { setEquityEdges } from './ladder.js';
import fs from 'node:fs';
setEquityEdges(JSON.parse(fs.readFileSync('buckets-eq.json', 'utf8')));

const deck = Array.from({ length: 52 }, (_, i) => i);
function deal(rng) {
  const d = [...deck];
  for (let i = 0; i < 9; i++) { const j = i + ((rng() * (52 - i)) | 0); [d[i], d[j]] = [d[j], d[i]]; }
  return { holes: [[d[0], d[1]], [d[2], d[3]]], board: d.slice(4, 9) };
}
let seed = 42;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };

let terminals = 0, maxActs = 0, sumU = 0;
for (let n = 0; n < 50000; n++) {
  const { holes, board } = deal(rng);
  let st = HUNL.initial(), steps = 0;
  while (!st.done) {
    const acts = HUNL.actions(st);
    if (!acts.length) throw new Error('no legal actions in live state: ' + JSON.stringify(st));
    st = HUNL.apply(st, acts[(rng() * acts.length) | 0]);
    if (++steps > 60) throw new Error('runaway hand: ' + st.rounds.join('/'));
    if (st.contrib[0] > HUNL.STACK || st.contrib[1] > HUNL.STACK) throw new Error('overcommit: ' + JSON.stringify(st.contrib));
    if (st.contrib[0] < 1 || st.contrib[1] < 2) throw new Error('undercommit');
  }
  terminals++;
  maxActs = Math.max(maxActs, steps);
  const u = HUNL.utility(st, holes, board);
  if (Math.abs(u) > HUNL.STACK) throw new Error('utility out of range: ' + u);
  if (st.folded === 0 && u !== -st.contrib[0]) throw new Error('fold accounting');
  sumU += u;
}
console.log(`fuzz: ${terminals.toLocaleString()} hands terminal · max ${maxActs} actions · mean button EV ${(sumU / terminals).toFixed(3)} (random-vs-random ≈ 0)`);

// determinism: same sequence twice = identical states
{
  let a = HUNL.initial(), b = HUNL.initial();
  for (const act of ['h', 'k', 'k', 'p', 'k', 'a', 'k']) {
    if (a.done) break;
    a = HUNL.apply(a, act); b = HUNL.apply(b, act);
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('nondeterminism');
  console.log('determinism: ok · sample line h/k k/p k/a-call ends contrib', a.contrib);
}
console.log('ALL NL TREE TESTS PASS');
