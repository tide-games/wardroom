// cepheus-compare.js — audit our trained preflop strategy against Cepheus,
// the essentially-solved heads-up limit hold'em strategy (Bowling et al.,
// Science 2015; data from poker.srv.ualberta.ca).
// run: node cepheus-compare.js <dir-with-cepheus-data-js-files>
import fs from 'node:fs';

const DIR = process.argv[2];
if (!DIR) { console.error('usage: node cepheus-compare.js <cepheus-data-dir>'); process.exit(1); }

// map Cepheus files to our betting-history keys (k=check/call, b=bet/raise)
const SEQS = [
  ['initialPreflop', '', 'button first action'],
  ['cPreflop', 'k', 'BB after a limp'],
  ['rPreflop', 'b', 'BB facing a raise'],
  ['crPreflop', 'kb', 'button: limp, then raised'],
  ['rrPreflop', 'bb', 'button facing a 3-bet'],
  ['crrPreflop', 'kbb', 'BB: limp-raise got 3-bet'],
  ['rrrPreflop', 'bbb', 'BB facing a cap'],
  ['crrrPreflop', 'kbbb', 'button: limp line capped'],
];

const RANKS = '23456789TJQKA';
function canonical(cards) {           // "Ac2d" -> {hi, lo, suited}
  const r1 = RANKS.indexOf(cards[0]), r2 = RANKS.indexOf(cards[2]);
  const suited = cards[1] === cards[3];
  return { hi: Math.max(r1, r2), lo: Math.min(r1, r2), suited };
}
function preflopIndex({ hi, lo, suited }) {
  if (hi === lo) return hi;
  const off = hi * (hi - 1) / 2 + lo;
  return 13 + (suited ? 0 : 78) + off;
}
function handName({ hi, lo, suited }) {
  if (hi === lo) return RANKS[hi] + RANKS[hi];
  return RANKS[hi] + RANKS[lo] + (suited ? 's' : 'o');
}

const ours = JSON.parse(fs.readFileSync('strategy-hulimit.json', 'utf8'));
console.log(`our table: ${ours.iterations.toLocaleString()} iterations\n`);

let grand = 0, grandN = 0;
for (const [file, hist, label] of SEQS) {
  const raw = fs.readFileSync(`${DIR}/${file}.js`, 'utf8');
  const json = JSON.parse(raw.slice(raw.indexOf('{')));
  // aggregate specific-suit combos to canonical 169
  const agg = new Map(); // idx -> {fold, call, raise, n, name}
  for (const row of json.data) {
    const c = canonical(row.cards);
    const idx = preflopIndex(c);
    let a = agg.get(idx);
    if (!a) { a = { fold: 0, call: 0, raise: 0, n: 0, name: handName(c) }; agg.set(idx, a); }
    a.fold += row.fold; a.call += row.call; a.raise += row.raise; a.n++;
  }
  const rows = [];
  for (const [idx, a] of agg) {
    const cep = { fold: a.fold / a.n, call: a.call / a.n, raise: a.raise / a.n };
    const key = `0|${idx}|${hist}`;
    const mine = ours.table[key];
    if (!mine) continue;
    // our acts: toCall>0 -> [call, raise, fold]; toCall==0 -> [check, raise]
    let m;
    if (mine.length === 3) m = { call: mine[0], raise: mine[1], fold: mine[2] };
    else m = { call: mine[0], raise: mine[1], fold: 0 };
    const diff = (Math.abs(cep.raise - m.raise) + Math.abs(cep.call - m.call) + Math.abs(cep.fold - m.fold)) / 2;
    rows.push({ name: a.name, cep, m, diff });
  }
  if (!rows.length) { console.log(`${label} (${hist || 'open'}): no overlap — our table lacks these spots\n`); continue; }
  const mad = rows.reduce((s, r) => s + r.diff, 0) / rows.length;
  grand += rows.reduce((s, r) => s + r.diff, 0); grandN += rows.length;
  rows.sort((x, y) => y.diff - x.diff);
  console.log(`=== ${label} ('${hist || 'open'}') — ${rows.length} hands, mean divergence ${(mad * 100).toFixed(1)}%`);
  for (const r of rows.slice(0, 3)) {
    console.log(`    worst ${r.name.padEnd(4)} ours r/c/f ${(r.m.raise * 100).toFixed(0)}/${(r.m.call * 100).toFixed(0)}/${(r.m.fold * 100).toFixed(0)}  cepheus ${(r.cep.raise * 100).toFixed(0)}/${(r.cep.call * 100).toFixed(0)}/${(r.cep.fold * 100).toFixed(0)}`);
  }
  const agree = rows.filter((r) => r.diff < 0.2).length;
  console.log(`    within 20% of solved play: ${agree}/${rows.length} hands\n`);
}
console.log(`OVERALL mean divergence from the solved strategy: ${(100 * grand / grandN).toFixed(1)}% across ${grandN} hand/sequence spots`);
