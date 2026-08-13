// train.js — the ladder's training rig. run: node train.js
// Today: solve Kuhn poker with vanilla CFR and verify against the known
// analytic solution (game value to player 0 = -1/18 ≈ -0.05556). This is the
// correctness gate for the solver core before it meets Leduc and then
// abstracted heads-up limit hold'em.
import { newSolver, KUHN } from './cfr.js';

const solver = newSolver(KUHN);
const t0 = Date.now();
const ITERS = 200_000;
for (let i = 0; i < ITERS / 1000; i++) solver.iterate(1000);
const avg = solver.averageStrategy();
const value = solver.valueOf(avg);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const TARGET = -1 / 18;
const err = Math.abs(value - TARGET);
console.log(`Kuhn poker, ${ITERS.toLocaleString()} CFR iterations in ${secs}s`);
console.log(`game value (player 0): ${value.toFixed(6)}  target ${TARGET.toFixed(6)}  |err| ${err.toFixed(6)}`);

// qualitative checks from the known solution family:
const p = (key, i) => (avg[key] ? avg[key][i] : NaN);
const checks = [
  ['P0 with K facing a bet always calls', p('K|cb', 0) > 0.98],
  ['P0 with J facing a bet always folds', p('J|cb', 1) > 0.98],
  ['P1 with K facing a bet always calls', p('K|b', 0) > 0.98],
  ['P1 with J facing a bet always folds', p('J|b', 1) > 0.98],
  ['P1 with Q always checks behind (bluffs ride on J)', p('Q|c', 0) > 0.98],
  ['P1 bluff-bets J after a check at exactly 1/3', Math.abs(p('J|c', 1) - 1 / 3) < 0.02],
  ['P1 with Q calls a bet at exactly 1/3', Math.abs(p('Q|b', 0) - 1 / 3) < 0.02],
  ['P0 bluffs J at some frequency α ∈ (0, 1/3)', p('J|', 1) > 0.005 && p('J|', 1) < 0.34],
  ['P0 bets K at 3α (consistency of the solution family)',
    Math.abs(p('K|', 1) - 3 * p('J|', 1)) < 0.05],
];
let fails = 0;
for (const [name, okc] of checks) {
  if (okc) console.log('  ok ', name);
  else { fails++; console.error('  FAIL', name); }
}
if (err > 0.002) { fails++; console.error(`  FAIL game value off by ${err.toFixed(5)}`); }

// show the famous mixed strategies
console.log('\nlearned strategy (probability of the second action):');
for (const key of ['J|', 'Q|', 'K|', 'J|c', 'Q|c', 'K|c', 'Q|b', 'Q|cb']) {
  if (avg[key]) console.log(`  ${key.padEnd(5)} ${avg[key].map((x) => x.toFixed(3)).join(' / ')}`);
}

if (fails) { console.error(`\n${fails} FAILURE(S)`); process.exit(1); }
console.log('\nCFR core verified against the known solution');
