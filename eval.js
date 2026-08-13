// eval.js — headless: the ladder's trained strategy vs the personality bots.
// run: node eval.js [handsPerPairing] [matchesPerPairing]
// Reports bb/100 over fixed-blind hands (the poker-standard winrate) and
// match win-rates over rising-blind heads-up tournaments.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { newHand, legal, act, seatView, rngFromSeed, LEVELS } from './poker.js';
import { decide } from './bots.js';
import { ladderDecide } from './ladder.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const HANDS = Number(process.argv[2] || 20000);
const MATCHES = Number(process.argv[3] || 300);

const meta = JSON.parse(fs.readFileSync('strategy-hulimit.json', 'utf8'));
const TABLE = meta.table;
console.log(`ladder table: ${meta.iterations.toLocaleString()} iterations, ${meta.infosets.toLocaleString()} infosets\n`);

function playHand({ seed, button, stacks, sb, bb, ladderSeat, profile, rng }) {
  const h = newHand({
    seats: [{ name: 'A', stack: stacks[0] }, { name: 'B', stack: stacks[1] }],
    button, sb, bb, seedHex: seed, limit: true,
  });
  let guard = 0;
  while (h.phase === 'act' && guard++ < 200) {
    const L = legal(h);
    let a;
    if (L.seat === ladderSeat) a = ladderDecide(h, L.seat, L, TABLE, 0, rng);
    else a = decide(seatView(h, L.seat), L, profile, rng, { rollouts: 40 });
    act(h, a);
  }
  return h.seats.map((s) => s.stack);
}

const PROFILES = ['tag', 'rock', 'lag', 'station', 'maniac'];
console.log('=== bb/100 over ' + HANDS.toLocaleString() + ' fixed-blind hands (10/20, stacks reset, button alternates) ===');
for (const profile of PROFILES) {
  let won = 0;
  const rng = rngFromSeed(sha256('eval-' + profile));
  for (let i = 0; i < HANDS; i++) {
    const after = playHand({
      seed: sha256(`eval|${profile}|${i}`), button: i % 2,
      stacks: [2000, 2000], sb: 10, bb: 20, ladderSeat: 0, profile, rng,
    });
    won += after[0] - 2000;
  }
  const bb100 = (won / 20 / HANDS) * 100;
  console.log(`  vs ${profile.padEnd(8)} ${bb100 >= 0 ? '+' : ''}${bb100.toFixed(1)} bb/100`);
}

console.log('\n=== match win-rate over ' + MATCHES + ' rising-blind tournaments (1500 chips, levels every 8 hands) ===');
for (const profile of PROFILES) {
  let wins = 0, totalHands = 0;
  for (let m = 0; m < MATCHES; m++) {
    const rng = rngFromSeed(sha256('m|' + profile + '|' + m));
    let stacks = [1500, 1500], button = m % 2, hand = 0;
    while (stacks[0] > 0 && stacks[1] > 0 && hand < 500) {
      const { sb, bb } = LEVELS[Math.min((hand / 8) | 0, LEVELS.length - 1)];
      stacks = playHand({
        seed: sha256(`m|${profile}|${m}|${hand}`), button,
        stacks, sb, bb, ladderSeat: 0, profile, rng,
      });
      button = 1 - button; hand++;
    }
    totalHands += hand;
    if (stacks[0] > 0) wins++;
  }
  console.log(`  vs ${profile.padEnd(8)} wins ${(100 * wins / MATCHES).toFixed(1)}%  (avg ${(totalHands / MATCHES).toFixed(0)} hands/match)`);
}
