// ab-river.js — does exact river play beat the table? A = table + river
// solver; B = table only. run: node ab-river.js [hands]
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { newHand, legal, act, rngFromSeed } from './poker.js';
import { ladderDecide } from './ladder.js';
import { riverMix } from './river-solver.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const T = JSON.parse(fs.readFileSync('strategy-hulimit.json', 'utf8'));
const HANDS = Number(process.argv[2] || 4000);
let won = 0, solves = 0;
const rng = rngFromSeed(sha256('abriver'));
const t0 = Date.now();
for (let i = 0; i < HANDS; i++) {
  const aSeat = i % 2;
  const h = newHand({
    seats: [{ name: 'S0', stack: 2000 }, { name: 'S1', stack: 2000 }],
    button: (i >> 1) % 2, sb: 10, bb: 20, seedHex: sha256('abr|' + i), limit: true,
  });
  const cache = {};
  let guard = 0;
  while (h.phase === 'act' && guard++ < 200) {
    const L = legal(h);
    let a = null;
    if (L.seat === aSeat && h.street === 3) {
      const mix = riverMix(h, L.seat, T.table, cache);
      if (mix) {
        solves++;
        let x = rng(), pick = 0;
        for (let k = 0; k < mix.probs.length; k++) { x -= mix.probs[k]; if (x <= 0) { pick = k; break; } }
        const ch = mix.acts[Math.min(pick, mix.acts.length - 1)];
        if (ch === 'f' && L.callAmount === 0) a = { seat: L.seat, action: 'check' };
        else if (ch === 'f') a = { seat: L.seat, action: 'fold' };
        else if (ch === 'k') a = { seat: L.seat, action: L.callAmount > 0 ? 'call' : 'check' };
        else if (L.actions.includes('bet')) a = { seat: L.seat, action: 'bet', amount: L.minRaiseTo };
        else if (L.actions.includes('raise')) a = { seat: L.seat, action: 'raise', amount: L.minRaiseTo };
        else a = { seat: L.seat, action: L.callAmount > 0 ? 'call' : 'check' };
      }
    }
    if (!a) a = ladderDecide(h, L.seat, L, T.table, 0, rng);
    act(h, a);
  }
  won += h.seats[aSeat].stack - 2000;
}
const bb100 = (won / 20 / HANDS) * 100;
const se = 2.4 * Math.sqrt(1 / HANDS) * 100;
console.log(`river-solver player earns ${bb100 >= 0 ? '+' : ''}${bb100.toFixed(2)} bb/100 vs pure table (±${se.toFixed(2)} SE)`);
console.log(`${HANDS} hands, ${solves} river decisions solved, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
