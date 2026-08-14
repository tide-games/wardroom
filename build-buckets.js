// build-buckets.js — derive the E[HS²] quantile edges that define the
// equity abstraction. run: node build-buckets.js [samplesPerStreet] [buckets]
import fs from 'node:fs';
import { ehs2, SAMPLES } from './equity-buckets.js';

const N = Number(process.argv[2] || 120000);
const B = Number(process.argv[3] || 800);
const out = {};
for (const [street, name, boardN] of [[1, 'flop', 3], [2, 'turn', 4]]) {
  const t0 = Date.now();
  const vals = new Float64Array(N);
  let x = 987654321 >>> 0;
  const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < N; i++) {
    // random hole + board without collision
    const deck = Array.from({ length: 52 }, (_, k) => k);
    for (let k = 0; k < 2 + boardN; k++) {
      const j = k + ((rnd() * (52 - k)) | 0);
      [deck[k], deck[j]] = [deck[j], deck[k]];
    }
    const hole = [deck[0], deck[1]];
    const board = deck.slice(2, 2 + boardN);
    const [r, o] = SAMPLES[street];
    vals[i] = ehs2(hole, board, r, o);
  }
  const sorted = Float64Array.from(vals).sort();
  const edges = [];
  for (let b = 1; b < B; b++) edges.push(sorted[Math.floor(b / B * N)]);
  out[name] = edges;
  console.log(`${name}: ${N} samples, ${B} buckets, ${((Date.now() - t0) / 1000).toFixed(0)}s  (median EHS2 ${sorted[N >> 1].toFixed(3)})`);
}
fs.writeFileSync('buckets-eq.json', JSON.stringify(out));
console.log(`buckets-eq.json ${(fs.statSync('buckets-eq.json').size / 1024).toFixed(0)}KB`);
