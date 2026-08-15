// graft-cepheus.js — replace our trained preflop strategy with the solved
// one. Cepheus (Bowling, Burch, Johanson, Tammelin — "Heads-up limit hold'em
// poker is solved", Science 2015; data from poker.srv.ualberta.ca) published
// per-hand preflop frequencies for every preflop betting sequence. Preflop is
// where our abstraction diverges most from solved play — and their data is
// exact there, so the ladder plays the solved game's preflop and our trained
// postflop. run: node graft-cepheus.js <cepheus-data-dir> [table.json]
import fs from 'node:fs';

const DIR = process.argv[2];
if (!DIR) { console.error('usage: node graft-cepheus.js <cepheus-data-dir>'); process.exit(1); }

// sequence -> [file, our act shape at that node]
// acts: k=check/call, b=bet/raise, f=fold. Preflop bet counts give the shape:
// '' faces the bb (3 acts), 'k' is the bb option (2, no fold), capped ('bbb',
// 'kbbb') cannot raise (2: call/fold).
const SEQS = [
  ['', 'initialPreflop', ['k', 'b', 'f']],
  ['k', 'cPreflop', ['k', 'b']],
  ['b', 'rPreflop', ['k', 'b', 'f']],
  ['kb', 'crPreflop', ['k', 'b', 'f']],
  ['bb', 'rrPreflop', ['k', 'b', 'f']],
  ['kbb', 'crrPreflop', ['k', 'b', 'f']],
  ['bbb', 'rrrPreflop', ['k', 'f']],
  ['kbbb', 'crrrPreflop', ['k', 'f']],
];

const RANKS = '23456789TJQKA';
function preflopIndexOf(cards) {
  const r1 = RANKS.indexOf(cards[0]), r2 = RANKS.indexOf(cards[2]);
  const suited = cards[1] === cards[3];
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  if (hi === lo) return hi;
  const off = hi * (hi - 1) / 2 + lo;
  return 13 + (suited ? 0 : 78) + off;
}

const TABLE_PATH = process.argv[3] || 'strategy-hulimit.json';
const ours = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));
let grafted = 0;
for (const [hist, file, shape] of SEQS) {
  const raw = fs.readFileSync(`${DIR}/${file}.js`, 'utf8');
  const json = JSON.parse(raw.slice(raw.indexOf('{')));
  const agg = new Map();
  for (const row of json.data) {
    const idx = preflopIndexOf(row.cards);
    let a = agg.get(idx);
    if (!a) { a = { fold: 0, call: 0, raise: 0, n: 0 }; agg.set(idx, a); }
    a.fold += row.fold; a.call += row.call; a.raise += row.raise; a.n++;
  }
  for (const [idx, a] of agg) {
    const p = { k: a.call / a.n, b: a.raise / a.n, f: a.fold / a.n };
    let probs = shape.map((act) => p[act]);
    const sum = probs.reduce((x, y) => x + y, 0);
    if (sum <= 0) continue;
    probs = probs.map((x) => +(x / sum).toFixed(4));
    ours.table[`0|${idx}|${hist}`] = probs;
    grafted++;
  }
}
ours.cepheusPreflop = {
  grafted,
  source: 'poker.srv.ualberta.ca (Bowling et al., "Heads-up limit hold\'em poker is solved", Science 347(6218), 2015)',
};
fs.writeFileSync(TABLE_PATH, JSON.stringify(ours));
console.log(`grafted ${grafted} solved preflop spots onto ${TABLE_PATH} (${(fs.statSync(TABLE_PATH).size / 1e6).toFixed(1)}MB)`);
