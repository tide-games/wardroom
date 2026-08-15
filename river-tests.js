// river-tests.js — run: node river-tests.js
import { createHash } from 'node:crypto';
import { solveRiver } from './river-solver.js';

let fails = 0;
const ok = (c, name, d) => { if (c) console.log('  ok ', name); else { fails++; console.error('  FAIL', name, d ?? ''); } };

const C = (str) => 'cdhs'.indexOf(str[1]) * 13 + '23456789TJQKA'.indexOf(str[0]);
const board = [C('Ks'), C('Qs'), C('7d'), C('2c'), C('9h')];   // K Q 7 2 9, two spades

// uniform ranges over the 47 remaining cards
function uniformRange(board) {
  const dead = new Set(board);
  const cards = []; for (let c = 0; c < 52; c++) if (!dead.has(c)) cards.push(c);
  const pairs = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) pairs.push([cards[i], cards[j]]);
  return { pairs, weights: new Float64Array(pairs.length).fill(1) };
}

{
  const t0 = Date.now();
  const R = uniformRange(board);
  const nuts = [C('Ah'), C('Ad')];    // wait — nuts on KQ729 is KK; use KK
  const kings = [C('Kh'), C('Kd')];   // top set: effective nuts vs uniform
  const solved = solveRiver({
    board, myHole: kings, oppDead: kings,
    myRange: R, oppRange: R,
    potIn: 240, bb: 20, iAmFirst: true, iters: 150,
  });
  const ms = Date.now() - t0;
  const open = solved.mixAt('');
  ok(open !== null, 'the solver answers at the river open');
  const bet = open.probs[open.acts.indexOf('b')];
  // vs a uniform range the equilibrium MIXES bet and slowplay (check-raise):
  // at equilibrium both lines have equal EV, so purity is not the invariant —
  // aggression somewhere is. Assert: betting is in the support, and the
  // slowplay line check-raises when the opponent bets.
  ok(bet > 0.2 && bet < 0.95, `top set mixes bet and trap at the open (bet=${(bet * 100).toFixed(0)}%)`, JSON.stringify(open));
  const afterCheck = solved.mixAt('kb');
  if (afterCheck) {
    const cr = afterCheck.probs[afterCheck.acts.indexOf('b')] ?? 0;
    ok(cr > 0.5, `the trap springs: check-raise ${(cr * 100).toFixed(0)}% when bet into`, JSON.stringify(afterCheck));
  }
  const vsRaise = solved.mixAt('bb');
  if (vsRaise) {
    const cap = vsRaise.probs[vsRaise.acts.indexOf('b')] ?? 0;
    const fold = vsRaise.probs[vsRaise.acts.indexOf('f')] ?? 0;
    ok(cap > 0.5 && fold < 0.05, `raised, top set re-raises (${(cap * 100).toFixed(0)}%) and never folds`, JSON.stringify(vsRaise));
  }
  ok(ms < 2000, `solve completes fast (${ms}ms)`);
  console.log(`  (solve: ${ms}ms for ${R.pairs.length} vs ${R.pairs.length} hands)`);
  ok(open.probs.every((p) => p >= -1e-9 && p <= 1 + 1e-9) && Math.abs(open.probs.reduce((a, b) => a + b, 0) - 1) < 1e-6,
    'mix is a proper distribution');
}

{
  // stone-cold air facing a bet: mostly fold, some bluff-catch is fine
  const R = uniformRange(board);
  const air = [C('3h'), C('4d')];
  const solved = solveRiver({
    board, myHole: air, oppDead: air,
    myRange: R, oppRange: R,
    potIn: 240, bb: 20, iAmFirst: false, iters: 150,
  });
  const facing = solved.mixAt('b');
  ok(facing !== null, 'the caller seat answers facing a bet');
  const fold = facing.probs[facing.acts.indexOf('f')];
  ok(fold > 0.6, `4-high folds to a river bet most of the time (fold=${(fold * 100).toFixed(0)}%)`, JSON.stringify(facing));
}

{
  // EV report: the leak meter's ground truth. At equilibrium, actions in the
  // support have (near-)equal EV; dominated actions show real losses.
  const R = uniformRange(board);
  const kings = [C('Kh'), C('Kd')];
  const solved = solveRiver({
    board, myHole: kings, oppDead: kings,
    myRange: R, oppRange: R,
    potIn: 240, bb: 20, iAmFirst: true, iters: 150,
  });
  const ev = solved.evsAt('');
  ok(ev !== null && ev.acts.length === 2, 'evsAt answers at the open');
  const evK = ev.evs[ev.acts.indexOf('k')], evB = ev.evs[ev.acts.indexOf('b')];
  // top set: both open actions are in the support -> EVs within a fraction
  // of a bet of each other (CFR at 150 iters is approximate)
  ok(Math.abs(evK - evB) < 40, `support actions near-equal EV (check ${evK.toFixed(1)} vs bet ${evB.toFixed(1)})`);
  ok(Math.max(evK, evB) > 0, `top set has positive EV at the open (${Math.max(evK, evB).toFixed(1)})`);

  const air = [C('3h'), C('4d')];
  const R2 = uniformRange(board);
  const solvedAir = solveRiver({
    board, myHole: air, oppDead: air,
    myRange: R2, oppRange: R2,
    potIn: 240, bb: 20, iAmFirst: false, iters: 150,
  });
  const evAir = solvedAir.evsAt('b');
  ok(evAir !== null && evAir.acts.length === 3, 'evsAt answers facing a bet');
  const aF = evAir.evs[evAir.acts.indexOf('f')];
  const aK = evAir.evs[evAir.acts.indexOf('k')];
  // 4-high facing a bet: folding beats calling by a meaningful margin —
  // the exact loss a station would be charged per bad call
  ok(aF > aK + 10, `folding air beats calling (fold ${aF.toFixed(1)} vs call ${aK.toFixed(1)})`);
  // fold EV equals surrendering the pot half: -(potIn/2) exactly
  ok(Math.abs(aF - (-120)) < 1e-6, `fold EV is exactly -pot/2 (${aF.toFixed(2)})`);
}

if (fails) { console.error(`\n${fails} FAILURE(S)`); process.exit(1); }
console.log('\nriver solver verified');
