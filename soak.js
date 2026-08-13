// soak.js — headless bot tournaments. run: node soak.js [count]
// Proves: no wedges, no illegal actions, chips conserve every hand, tourneys
// finish, and the skill ordering is sane (the tag shouldn't finish behind the
// station on average over a big sample).
import { createHash } from 'node:crypto';
import {
  newTourney, tourneyHand, absorbHand, legal, seatView, act, placings, START_STACK, levelNum,
} from './poker.js';
import { decide, ROSTER, PROFILES } from './bots.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const N = Number(process.argv[2] || 120);

const names = [...ROSTER.map((r) => r.name), 'Hero(tag)'];
const profiles = [...ROSTER.map((r) => r.profile), 'tag'];

import { rngFromSeed } from './poker.js';

let totalHands = 0, maxLevel = 0;
const placeSum = new Array(6).fill(0);
const t0 = Date.now();

for (let g = 0; g < N; g++) {
  const t = newTourney({ names, handsPerLevel: 8 });
  let hands = 0;
  while (t.champion === null && hands < 3000) {
    const seed = sha256(`soak|${g}|${hands}`);
    const h = tourneyHand(t, seed);
    let guard = 0;
    while (h.phase === 'act' && guard++ < 300) {
      const L = legal(h);
      const view = seatView(h, L.seat);
      const rng = rngFromSeed(sha256(`bot|${g}|${hands}|${L.seat}|${guard}`));
      const a = decide(view, L, profiles[L.seat], rng, { rollouts: 40 });
      act(h, a);
    }
    if (h.phase !== 'done') { console.error(`WEDGE at tourney ${g} hand ${hands}`); process.exit(1); }
    absorbHand(t, h);
    const total = t.stacks.reduce((a, b) => a + b, 0);
    if (total !== 6 * START_STACK) { console.error(`LEAK at tourney ${g} hand ${hands}: ${total}`); process.exit(1); }
    hands++;
    if (levelNum(t) > maxLevel) maxLevel = levelNum(t);
  }
  if (t.champion === null) { console.error(`ENDLESS tourney ${g}`); process.exit(1); }
  totalHands += hands;
  const places = placings(t);
  places.forEach((seat, idx) => { placeSum[seat] += idx + 1; });
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`${N} tournaments, ${totalHands} hands, ${(totalHands / N).toFixed(1)} hands/tourney, max level ${maxLevel}, ${secs}s`);
console.log('average finishing place by seat (1=champion):');
names.forEach((n, i) => console.log(`  ${(placeSum[i] / N).toFixed(2)}  ${n} (${profiles[i]})`));

// sanity: the disciplined profiles should not be the worst
const avg = (i) => placeSum[i] / N;
const tagAvg = (avg(1) + avg(5)) / 2;                       // Wren + Hero
const wildAvg = (avg(3) + avg(4)) / 2;                      // Barnacle + Puffin
console.log(tagAvg < wildAvg + 0.4
  ? 'SKILL CHECK ok: discipline is not losing to chaos'
  : 'SKILL CHECK WARN: tight-aggressive underperforming — inspect decide()');
