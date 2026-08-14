// ab-tables.js — head-to-head: strategy table A vs table B, both played by
// ladderDecide at zero noise. run: node ab-tables.js <tableA.json> <tableB.json> [hands]
// Fixed blinds, stacks reset each hand, button alternates; reports A's bb/100.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { newHand, legal, act, rngFromSeed } from './poker.js';
import { ladderDecide } from './ladder.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const A = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const B = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const HANDS = Number(process.argv[4] || 100000);
console.log(`A: ${A.iterations.toLocaleString()} iters   B: ${B.iterations.toLocaleString()} iters   ${HANDS.toLocaleString()} hands`);

let won = 0;
const rng = rngFromSeed(sha256('ab'));
for (let i = 0; i < HANDS; i++) {
  const aSeat = i % 2;                       // A alternates seats/button
  const h = newHand({
    seats: [{ name: 'S0', stack: 2000 }, { name: 'S1', stack: 2000 }],
    button: (i >> 1) % 2, sb: 10, bb: 20, seedHex: sha256('ab|' + i), limit: true,
  });
  let guard = 0;
  while (h.phase === 'act' && guard++ < 200) {
    const L = legal(h);
    const table = L.seat === aSeat ? A.table : B.table;
    act(h, ladderDecide(h, L.seat, L, table, 0, rng));
  }
  won += h.seats[aSeat].stack - 2000;
}
const bb100 = (won / 20 / HANDS) * 100;
const se = 2.4 * Math.sqrt(1 / HANDS) * 100;   // rough ±SE for limit HU
console.log(`A earns ${bb100 >= 0 ? '+' : ''}${bb100.toFixed(2)} bb/100  (±${se.toFixed(2)} SE)`);
