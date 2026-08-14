// lbr.js — Local Best Response (Lisý & Bowling 2017): a practical LOWER
// BOUND on the exploitability of the ladder bot. The exploiter knows the
// bot's entire strategy, tracks the bot's range hand by hand (Bayes over the
// table's action probabilities), and at every decision greedily maximizes EV
// under the standard LBR simplification (after this action, both players
// check/call to showdown). The exploiter's winrate is the bound.
//
//   node lbr.js [hands] [river]   — 'river' arms the bot's river solver
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { newHand, legal, act, rngFromSeed, evaluate } from './poker.js';
import { ladderDecide, streetBucket } from './ladder.js';
import { riverMix } from './river-solver.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const T = JSON.parse(fs.readFileSync('strategy-hulimit.json', 'utf8'));
const HANDS = Number(process.argv[2] || 2000);
const BOT_RIVER_SOLVER = process.argv.includes('river');
console.log(`LBR vs ${T.iterations.toLocaleString()}-iteration table${T.cepheusPreflop ? ' + solved preflop' : ''}${BOT_RIVER_SOLVER ? ' + river solver' : ''}, ${HANDS} hands`);

// all 1326 hole pairs
const ALL = [];
for (let i = 0; i < 52; i++) for (let j = i + 1; j < 52; j++) ALL.push([i, j]);
const NP = ALL.length;

// the bot's action shape at a betting state (mirrors the engine's limit rules)
const shapeFor = (toCall, bets) => (toCall > 0 ? (bets < 4 ? ['k', 'b', 'f'] : ['k', 'f']) : ['k', 'b']);

function probOf(row, shape, sym) {
  if (!row || row.length !== shape.length) return null;
  const i = shape.indexOf(sym);
  return i < 0 ? 0 : row[i];
}

// equity of `hole` vs weighted range on `board` (sampled runouts pre-river)
function equityVs(hole, board, weights, rng) {
  // prune to the heavy part of the range
  const idx = [];
  for (let p = 0; p < NP; p++) if (weights[p] > 0) idx.push(p);
  idx.sort((a, b) => weights[b] - weights[a]);
  let cum = 0, total = 0;
  for (const p of idx) total += weights[p];
  const keep = [];
  for (const p of idx) { keep.push(p); cum += weights[p]; if (cum >= total * 0.97 || keep.length >= 320) break; }
  const need = 5 - board.length;
  const dead = new Set([...board, ...hole]);
  const pool = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) pool.push(c);
  const R = need === 0 ? 1 : 14;
  let eq = 0, wsum = 0;
  for (let r = 0; r < R; r++) {
    const full = [...board];
    if (need > 0) {
      const pp = [...pool];
      for (let i = 0; i < need; i++) {
        const j = i + ((rng() * (pp.length - i)) | 0);
        [pp[i], pp[j]] = [pp[j], pp[i]];
        full.push(pp[i]);
      }
    }
    const mine = evaluate([...hole, ...full]).score;
    for (const p of keep) {
      const [a, b] = ALL[p];
      if (dead.has(a) || dead.has(b) || full.includes(a) || full.includes(b)) continue;
      const theirs = evaluate([a, b, ...full]).score;
      const w = weights[p];
      wsum += w;
      if (mine > theirs) eq += w;
      else if (mine === theirs) eq += w / 2;
    }
  }
  return wsum > 0 ? eq / wsum : 0.5;
}

let won = 0, decisions = 0;
const t0 = Date.now();
for (let hand = 0; hand < HANDS; hand++) {
  const me = hand % 2, bot = 1 - me;
  const h = newHand({
    seats: [{ name: 'S0', stack: 4000 }, { name: 'S1', stack: 4000 }],
    button: (hand >> 1) % 2, sb: 10, bb: 20, seedHex: sha256('lbr|' + hand), limit: true,
  });
  const rng = rngFromSeed(sha256('lbr-rng|' + hand));
  const cache = {};

  // bot range: uniform over pairs not colliding with my cards
  const w = new Float64Array(NP).fill(1);
  const myHole = h.seats[me].hole;
  for (let p = 0; p < NP; p++) {
    const [a, b] = ALL[p];
    if (myHole.includes(a) || myHole.includes(b)) w[p] = 0;
  }
  // incremental log processing: keep rounds + react to bot actions/streets
  let logPos = h.log.length;      // skip deal/blind entries
  let street = 0;
  const rounds = ['', '', '', ''];
  let bets = 1, toCall0 = 0;      // preflop: bb counts as first bet
  function digest() {
    for (; logPos < h.log.length; logPos++) {
      const e = h.log[logPos];
      if (e.ev === 'street') {
        street = ['preflop', 'flop', 'turn', 'river'].indexOf(e.street);
        bets = 0;
        for (let p = 0; p < NP; p++) {
          const [a, b] = ALL[p];
          if (h.board.includes(a) || h.board.includes(b)) w[p] = 0;
        }
        continue;
      }
      if (!['fold', 'check', 'call', 'bet', 'raise'].includes(e.ev)) continue;
      const sym = e.ev === 'fold' ? 'f' : (e.ev === 'bet' || e.ev === 'raise') ? 'b' : 'k';
      const pending = rounds[street].endsWith('b') ||
        (street === 0 && rounds[street] === '' ) ||
        (street === 0 && !rounds[street].includes('b') && rounds[street].length === 0);
      if (e.seat === bot && street < 3) {
        // shape at the bot's node: reconstruct toCall from round string
        const rs = rounds[street];
        const facing = rs.endsWith('b') || (street === 0 && (rs === '' || (!rs.includes('b') && rs.length === 0)));
        const shape = shapeFor(facing ? 1 : 0, street === 0 ? rounds[0].split('b').length + 0 + (1 + (rs.match(/b/g) || []).length) - 1 : (rs.match(/b/g) || []).length >= 4 ? 4 : (rs.match(/b/g) || []).length);
        const histKey = rounds.slice(0, street + 1).join('/');
        for (let p = 0; p < NP; p++) {
          if (w[p] === 0) continue;
          const bkt = streetBucket(street, ALL[p], h.board);
          const row = T.table[street + '|' + bkt + '|' + histKey];
          // use row-shape as authority (k is always index 0; f always last of 3)
          let pr = null;
          if (row) {
            if (row.length === 3) pr = sym === 'k' ? row[0] : sym === 'b' ? row[1] : row[2];
            else if (row.length === 2) pr = sym === 'k' ? row[0] : row[1];
          }
          if (pr !== null) w[p] *= Math.max(pr, 0.001);
        }
      }
      rounds[street] += sym;
    }
  }

  let guard = 0;
  while (h.phase === 'act' && guard++ < 200) {
    digest();
    const L = legal(h);
    if (L.seat === bot) {
      let a = null;
      if (BOT_RIVER_SOLVER && h.street === 3) {
        const mix = riverMix(h, bot, T.table, cache);
        if (mix) {
          let x = rng(), pick = 0;
          for (let k = 0; k < mix.probs.length; k++) { x -= mix.probs[k]; if (x <= 0) { pick = k; break; } }
          const ch = mix.acts[Math.min(pick, mix.acts.length - 1)];
          if (ch === 'f' && L.callAmount > 0) a = { seat: bot, action: 'fold' };
          else if (ch === 'b' && (L.actions.includes('bet') || L.actions.includes('raise'))) {
            a = { seat: bot, action: L.actions.includes('bet') ? 'bet' : 'raise', amount: L.minRaiseTo };
          } else a = { seat: bot, action: L.callAmount > 0 ? 'call' : 'check' };
        }
      }
      if (!a) a = ladderDecide(h, bot, L, T.table, 0, rng);
      act(h, a);
      continue;
    }
    // ---- the exploiter decides
    decisions++;
    const pot = h.seats.reduce((s, x) => s + x.handCommit, 0);
    const c = L.callAmount;
    const eq = equityVs(myHole, h.board, w, rng);
    const evs = { fold: c > 0 ? 0 : -Infinity };
    evs[c > 0 ? 'call' : 'check'] = eq * (pot + c) - c;
    if (L.actions.includes('bet') || L.actions.includes('raise')) {
      const added = L.minRaiseTo - h.seats[me].streetCommit;
      const betSize = h.street <= 1 ? h.bb : 2 * h.bb;
      // bot's response distribution + posterior continue-range
      const histKey = rounds.slice(0, h.street + 1).join('/') + 'b';
      const respShape = shapeFor(1, (rounds[h.street].match(/b/g) || []).length + 1 + (h.street === 0 ? 1 : 0));
      let fe = 0, tot = 0;
      const wCall = new Float64Array(NP);
      for (let p = 0; p < NP; p++) {
        if (w[p] === 0) continue;
        const bkt = streetBucket(h.street, ALL[p], h.board);
        const row = T.table[h.street + '|' + bkt + '|' + histKey];
        let pf = 0.33, pc = 0.67;
        if (row) {
          if (row.length === 3) { pf = row[2]; pc = row[0] + row[1]; }
          else if (row.length === 2) { pf = row[1]; pc = row[0]; }
        }
        fe += w[p] * pf; tot += w[p];
        wCall[p] = w[p] * pc;
      }
      fe = tot > 0 ? fe / tot : 0.3;
      const eqPost = equityVs(myHole, h.board, wCall, rng);
      evs.raise = fe * pot + (1 - fe) * (eqPost * (pot + added + betSize) - added);
    }
    let best = null, bestEv = -Infinity;
    for (const [k, v] of Object.entries(evs)) if (v > bestEv) { bestEv = v; best = k; }
    let a;
    if (best === 'fold') a = { seat: me, action: 'fold' };
    else if (best === 'raise') a = { seat: me, action: L.actions.includes('bet') ? 'bet' : 'raise', amount: L.minRaiseTo };
    else a = { seat: me, action: c > 0 ? 'call' : 'check' };
    act(h, a);
  }
  won += h.seats[me].stack - 4000;
  if ((hand + 1) % 500 === 0) {
    const bb100 = (won / 20 / (hand + 1)) * 100;
    console.log(`  ${hand + 1}/${HANDS}  exploiter ${bb100 >= 0 ? '+' : ''}${bb100.toFixed(1)} bb/100`);
  }
}
const bb100 = (won / 20 / HANDS) * 100;
const se = 2.6 * Math.sqrt(1 / HANDS) * 100;
console.log(`\nLBR exploiter earns ${bb100 >= 0 ? '+' : ''}${bb100.toFixed(1)} bb/100 (±${se.toFixed(1)} SE) over ${decisions} decisions in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('(a LOWER bound on exploitability: a real best response earns at least this)');
