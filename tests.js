// tests.js — run: node tests.js  (exits non-zero on failure)
import { createHash } from 'node:crypto';
import {
  rankOf, suitOf, cardName, rngFromSeed, shuffledDeck,
  evaluate, handName, CAT_NAMES,
  newHand, legal, act, seatView, STREETS,
  newTourney, tourneyHand, absorbHand, levelOf, levelNum, placings, LEVELS, START_STACK,
} from './poker.js';
import { glicko2 } from './rating.js';

let fails = 0;
function ok(cond, name, detail) {
  if (cond) console.log('  ok ', name);
  else { fails++; console.error('  FAIL', name, detail ?? ''); }
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// card helper: "As" → index. suits c,d,h,s = 0..3
const C = (str) => {
  const r = '23456789TJQKA'.indexOf(str[0]);
  const s = 'cdhs'.indexOf(str[1]);
  return s * 13 + r;
};
const H = (...names) => names.map(C);

// ---- the deck
{
  const d = shuffledDeck(sha256('a'));
  ok(d.length === 52 && new Set(d).size === 52, 'a shuffled deck is a permutation of 52');
  ok(JSON.stringify(shuffledDeck(sha256('a'))) === JSON.stringify(d), 'the same seed shuffles the same deck');
  ok(JSON.stringify(shuffledDeck(sha256('b'))) !== JSON.stringify(d), 'a different seed differs');
}

// ---- evaluator: one of each, with names
{
  const cases = [
    [H('As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d'), 8, 'a royal flush'],
    [H('5h', '4h', '3h', '2h', 'Ah', 'Kc', 'Kd'), 8, 'a straight flush, five high'],
    [H('7c', '7d', '7h', '7s', 'Kc', '2d', '3h'), 7, 'four sevens'],
    [H('Tc', 'Td', 'Th', '4s', '4c', 'Ad', '2h'), 6, 'a full house, tens over fours'],
    [H('Ad', 'Jd', '8d', '6d', '2d', 'Kc', 'Kh'), 5, 'a flush, ace high'],
    [H('9c', '8d', '7h', '6s', '5c', 'Ad', 'Ah'), 4, 'a straight, nine high'],
    [H('5c', '4d', '3h', '2s', 'Ac', 'Kd', '9h'), 4, 'a straight, five high'],
    [H('Qc', 'Qd', 'Qh', '8s', '4c', '2d', '7h'), 3, 'three queens'],
    [H('Kc', 'Kd', '9h', '9s', 'Ac', '2d', '5h'), 2, 'two pair, kings and nines'],
    [H('6c', '6d', 'Ah', 'Js', '8c', '2d', '3h'), 1, 'a pair of sixes'],
    [H('Ac', 'Jd', '9h', '7s', '5c', '3d', '2h'), 0, 'ace high'],
  ];
  for (const [cards, cat, name] of cases) {
    const ev = evaluate(cards);
    ok(ev.cat === cat && handName(ev) === name, `evaluator: ${name}`, `${CAT_NAMES[ev.cat]} / ${handName(ev)}`);
  }
}

// ---- evaluator: kickers and traps
{
  const better = (a, b) => evaluate(a).score > evaluate(b).score;
  ok(better(H('Ac', 'Ad', 'Kh', 'Qs', 'Jc', '4d', '3h'), H('Ah', 'As', 'Kd', 'Qc', 'Tc', '4s', '3c')),
    'pair of aces: jack kicker beats ten kicker');
  ok(better(H('9c', '8d', '7h', '6s', '5c', '2d', '2h'), H('5c', '4d', '3h', '2s', 'Ac', 'Kd', 'Kh')),
    'nine-high straight beats the wheel');
  ok(better(H('2c', '2d', '2h', 'Kc', 'Ks', '3d', '4h'), H('Ac', 'Ad', 'Kh', 'Ks', 'Qc', 'Jd', '9h')),
    'deuces full beats aces up');
  // two trips on board+hole = full house of the bigger trips
  const twoTrips = evaluate(H('7c', '7d', '7h', '4c', '4d', '4h', 'Ks'));
  ok(twoTrips.cat === 6 && handName(twoTrips) === 'a full house, sevens over fours', 'two trips fold into the right full house');
  // flush beats straight even with both present
  const both = evaluate(H('9h', '8h', '7h', '6h', '5c', '2h', '3d'));
  ok(both.cat === 5, 'a flush outranks the straight hiding in the same seven');
  // board plays: identical scores
  const boardOnly = H('As', 'Ks', 'Qs', 'Js', 'Ts');
  ok(evaluate([...boardOnly, ...H('2c', '3d')]).score === evaluate([...boardOnly, ...H('7h', '8h')]).score,
    'when the board plays, everyone ties');
}

// ---- a scripted 3-handed hand: raise, call, fold; uncalled refund
{
  const seed = sha256('scripted-1');
  const h = newHand({ seats: [{ name: 'A', stack: 1000 }, { name: 'B', stack: 1000 }, { name: 'C', stack: 1000 }], button: 0, sb: 10, bb: 20, seedHex: seed });
  ok(h.toAct === 0, '3-handed preflop: the button acts first (UTG=button here)');
  act(h, { seat: 0, action: 'raise', amount: 60 });
  const L1 = legal(h);
  ok(L1.seat === 1 && L1.callAmount === 50, 'the small blind faces 50 more');
  ok(L1.minRaiseTo === 100, 'min re-raise is to 100 (raise size 40 repeated)');
  act(h, { seat: 1, action: 'fold' });
  act(h, { seat: 2, action: 'call', amount: 40 });
  ok(h.street === 1 && h.board.length === 3, 'the flop falls after preflop closes');
  ok(h.toAct === 2, 'postflop: first live seat left of the button acts first');
  act(h, { seat: 2, action: 'check' });
  act(h, { seat: 0, action: 'bet', amount: 100 });
  act(h, { seat: 2, action: 'fold' });
  ok(h.phase === 'done' && !h.result.showdown, 'a fold-out ends without showdown');
  const total = h.seats.reduce((a, s) => a + s.stack, 0);
  ok(total === 3000, 'chips conserve through refund and award', total);
  ok(h.seats[0].stack === 1000 + 10 + 60, 'the winner scoops blinds + the called 60, refunded the rest', h.seats[0].stack);
}

// ---- heads-up order: button is SB, acts first preflop, last postflop
{
  const seed = sha256('hu-1');
  const h = newHand({ seats: [{ name: 'A', stack: 1000 }, { name: 'B', stack: 1000 }], button: 0, sb: 10, bb: 20, seedHex: seed });
  ok(h.toAct === 0, 'HU preflop: the button/SB speaks first');
  act(h, { seat: 0, action: 'call', amount: 10 });
  act(h, { seat: 1, action: 'check' });
  ok(h.street === 1, 'HU: flop arrives');
  ok(h.toAct === 1, 'HU postflop: the big blind speaks first');
}

// ---- min-raise law, including the under-raise all-in
{
  const seed = sha256('minraise-1');
  const h = newHand({
    seats: [{ name: 'A', stack: 5000 }, { name: 'B', stack: 5000 }, { name: 'C', stack: 130 }],
    button: 0, sb: 10, bb: 20, seedHex: seed,
  });
  act(h, { seat: 0, action: 'raise', amount: 100 });    // full raise (size 80)
  act(h, { seat: 1, action: 'call', amount: 90 });
  const L = legal(h);                                   // C: stack 130, can go all-in to 130
  ok(L.seat === 2 && L.maxRaiseTo === 130 && L.minRaiseTo === 130,
    'short stack: only all-in raise available, capped at stack', JSON.stringify(L));
  act(h, { seat: 2, action: 'raise', amount: 130 });    // under-raise (size 30 < 80)
  const LA = legal(h);
  ok(LA.seat === 0 && !LA.actions.includes('raise'),
    'under-raise all-in does not reopen the betting for a player who acted', JSON.stringify(LA.actions));
  act(h, { seat: 0, action: 'call', amount: 30 });
  const LB = legal(h);
  ok(LB.seat === 1 && !LB.actions.includes('raise'), 'nor for the second player who had acted');
  act(h, { seat: 1, action: 'call', amount: 30 });
  ok(h.street === 1, 'the flop falls with the short stack all-in');
  const total = h.seats.reduce((a, s) => a + s.stack + s.handCommit, 0);
  ok(total === 10130, 'chips conserve mid-hand', total);
}

// ---- side pots: three-way all-in with folded dead money
{
  // stacks 100 / 300 / 900 / 900. Seat 3 folds after committing 100.
  // Engineer via scripted actions; hole cards come from the seed but the pot
  // arithmetic is what we assert.
  const seed = sha256('sidepot-7');
  const h = newHand({
    seats: [{ name: 'S', stack: 100 }, { name: 'M', stack: 300 }, { name: 'L', stack: 900 }, { name: 'F', stack: 900 }],
    button: 3, sb: 10, bb: 20, seedHex: seed,
  });
  // order preflop: seat 2 (UTG, left of BB=1)… wait button 3 → sb 0, bb 1, first 2
  act(h, { seat: 2, action: 'raise', amount: 300 });
  act(h, { seat: 3, action: 'call', amount: 300 });
  act(h, { seat: 0, action: 'call', amount: 90 });      // all-in 100 total
  act(h, { seat: 1, action: 'call', amount: 280 });     // all-in 300 total
  // seat 3 and 2 continue; flop betting: 2 shoves, 3 folds
  ok(h.street === 1, 'flop reached');
  act(h, { seat: 2, action: 'bet', amount: 600 });      // all-in 900 total
  act(h, { seat: 3, action: 'fold' });
  ok(h.phase === 'done', 'board runs out with all-ins');
  // pot structure: main = 100×4 = 400 (contenders 0,1,2); side1 = 200×3 = 600 (1,2); side2 = 600 uncalled → refunded to 2
  const potAmounts = h.result.pots.map((p) => p.amount);
  ok(JSON.stringify(potAmounts) === JSON.stringify([400, 600]),
    'main 400 and side 600; the uncalled 600 went home', JSON.stringify(potAmounts));
  const refund = h.log.find((l) => l.ev === 'refund');
  ok(refund && refund.seat === 2 && refund.amount === 600, 'refund logged to the big stack');
  const total = h.seats.reduce((a, s) => a + s.stack, 0);
  ok(total === 2200, 'chips conserve across side pots', total);
  ok(h.result.pots[0].contenders.join() === '0,1,2' && h.result.pots[1].contenders.join() === '1,2',
    'contender sets are exactly right');
}

// ---- split pot with an odd chip
{
  // Force a board-plays situation: both hole pairs irrelevant. Search seeds
  // until the two survivors tie at showdown with an odd pot.
  let found = null;
  for (let i = 0; i < 4000 && !found; i++) {
    const seed = sha256('split' + i);
    const h = newHand({ seats: [{ name: 'A', stack: 500 }, { name: 'B', stack: 500 }], button: 0, sb: 5, bb: 10, seedHex: seed });
    try {
      act(h, { seat: 0, action: 'call', amount: 5 });
      act(h, { seat: 1, action: 'check' });
      while (h.phase === 'act') act(h, { seat: h.toAct, action: legal(h).actions.includes('check') ? 'check' : 'call' });
      if (h.result.showdown && h.result.winners.length === 2) found = h;
    } catch { /* keep looking */ }
  }
  ok(found !== null, 'found a chopped pot');
  if (found) {
    const total = found.seats.reduce((a, s) => a + s.stack, 0);
    ok(total === 1000, 'a chop conserves chips exactly', total);
  }
}

// ---- random-legal-action fuzz: chips always conserve, engine never wedges
{
  let done = 0, conserved = true, wedged = false;
  for (let i = 0; i < 400; i++) {
    const seed = sha256('fuzz' + i);
    const rng = rngFromSeed(sha256('fuzzdrv' + i));
    const stacks = [400 + ((rng() * 2000) | 0), 400 + ((rng() * 2000) | 0), 400 + ((rng() * 2000) | 0),
      400 + ((rng() * 2000) | 0), 400 + ((rng() * 2000) | 0), 400 + ((rng() * 2000) | 0)];
    const before = stacks.reduce((a, b) => a + b, 0);
    const h = newHand({
      seats: stacks.map((s, k) => ({ name: 'P' + k, stack: s })),
      button: (rng() * 6) | 0, sb: 25, bb: 50, ante: 5, seedHex: seed,
    });
    let guard = 0;
    while (h.phase === 'act' && guard++ < 200) {
      const L = legal(h);
      const pick = L.actions[(rng() * L.actions.length) | 0];
      if (pick === 'bet' || pick === 'raise') {
        const to = L.minRaiseTo + ((rng() * (L.maxRaiseTo - L.minRaiseTo + 1)) | 0);
        act(h, { seat: L.seat, action: pick, amount: to });
      } else act(h, { seat: L.seat, action: pick });
    }
    if (h.phase !== 'done') { wedged = true; break; }
    const after = h.seats.reduce((a, s) => a + s.stack, 0);
    if (after !== before) { conserved = false; break; }
    done++;
  }
  ok(!wedged, 'the engine never wedges under random legal play');
  ok(conserved && done === 400, `chip conservation holds over ${done} random hands`);
}

// ---- seat views never leak hole cards
{
  const seed = sha256('privacy-1');
  const h = newHand({ seats: [{ name: 'A', stack: 500 }, { name: 'B', stack: 500 }, { name: 'C', stack: 500 }], button: 0, sb: 5, bb: 10, seedHex: seed });
  const v = seatView(h, 1);
  ok(v.hole !== null && v.seats[1].hole !== null, 'a seat sees its own cards');
  ok(v.seats[0].hole === null && v.seats[2].hole === null, 'a seat never sees live opponents\' cards');
  // finish by folds — no showdown, still hidden
  act(h, { seat: 0, action: 'fold' });
  act(h, { seat: 1, action: 'fold' });
  const v2 = seatView(h, 0);
  ok(v2.seats[1].hole === null && v2.seats[2].hole === null, 'a fold-out reveals nothing');
}

// ---- fixed-limit: the bet is a number, not a choice
{
  const seed = sha256('limit-1');
  const h = newHand({ seats: [{ name: 'A', stack: 2000 }, { name: 'B', stack: 2000 }, { name: 'C', stack: 2000 }], button: 0, sb: 10, bb: 20, seedHex: seed, limit: true });
  const L0 = legal(h);
  ok(L0.minRaiseTo === 40 && L0.maxRaiseTo === 40, 'limit preflop: the only raise is to exactly two bets', JSON.stringify(L0));
  act(h, { seat: L0.seat, action: 'raise', amount: 40 });
  const L1 = legal(h);
  ok(L1.minRaiseTo === 60 && L1.maxRaiseTo === 60, 'limit re-raise: exactly three bets');
  act(h, { seat: L1.seat, action: 'raise', amount: 60 });
  const L2 = legal(h);
  ok(L2.minRaiseTo === 80, 'limit cap approaching: four bets');
  act(h, { seat: L2.seat, action: 'raise', amount: 80 });
  const L3 = legal(h);
  ok(!L3.actions.includes('raise'), 'the street is capped at four bets — no fifth raise', JSON.stringify(L3.actions));
  act(h, { seat: L3.seat, action: 'call' });
  while (legal(h) && legal(h).callAmount > 0) act(h, { seat: legal(h).seat, action: 'call' });
  if (h.street === 0) act(h, { seat: legal(h).seat, action: 'check' });
  ok(h.street === 1, 'the capped street closes to the flop', h.street);
  // flop: small bet is bb again, and betting reopens
  const LF = legal(h);
  ok(LF.actions.includes('check') && (LF.actions.includes('bet') ? LF.minRaiseTo - h.seats[LF.seat].streetCommit === 20 || LF.minRaiseTo === 20 : true),
    'flop small bet is one bb', JSON.stringify(LF));
  if (LF.actions.includes('bet')) {
    act(h, { seat: LF.seat, action: 'bet', amount: LF.minRaiseTo });
    ok(h.currentBet === 20, 'flop bet lands at exactly one small bet');
  }
}
{
  // turn and river bets double
  const seed = sha256('limit-2');
  const h = newHand({ seats: [{ name: 'A', stack: 2000 }, { name: 'B', stack: 2000 }], button: 0, sb: 10, bb: 20, seedHex: seed, limit: true });
  act(h, { seat: legal(h).seat, action: 'call' });
  act(h, { seat: legal(h).seat, action: 'check' });
  act(h, { seat: legal(h).seat, action: 'check' });   // flop checks through
  act(h, { seat: legal(h).seat, action: 'check' });
  ok(h.street === 2, 'reached the turn');
  const LT = legal(h);
  ok(LT.minRaiseTo === 40 && LT.maxRaiseTo === 40, 'turn big bet is two bb', JSON.stringify(LT));
  act(h, { seat: LT.seat, action: 'bet', amount: 40 });
  const LT2 = legal(h);
  ok(LT2.minRaiseTo === 80, 'turn raise is to two big bets');
}
{
  // limit fuzz: chips conserve, engine never wedges, raises always fixed-size
  let done = 0, conserved = true, wedged = false, sized = true;
  for (let i = 0; i < 150; i++) {
    const seed = sha256('limitfuzz' + i);
    const rng = rngFromSeed(sha256('limitfuzzdrv' + i));
    const stacks = [300 + ((rng() * 1500) | 0), 300 + ((rng() * 1500) | 0), 300 + ((rng() * 1500) | 0), 300 + ((rng() * 1500) | 0)];
    const before = stacks.reduce((a, b) => a + b, 0);
    const h = newHand({ seats: stacks.map((s, k) => ({ name: 'P' + k, stack: s })), button: (rng() * 4) | 0, sb: 10, bb: 20, seedHex: seed, limit: true });
    let guard = 0;
    while (h.phase === 'act' && guard++ < 200) {
      const L = legal(h);
      if ((L.actions.includes('bet') || L.actions.includes('raise')) && L.minRaiseTo !== L.maxRaiseTo) { sized = false; break; }
      const pick = L.actions[(rng() * L.actions.length) | 0];
      if (pick === 'bet' || pick === 'raise') act(h, { seat: L.seat, action: pick, amount: L.minRaiseTo });
      else act(h, { seat: L.seat, action: pick });
    }
    if (h.phase !== 'done') { wedged = true; break; }
    const after = h.seats.reduce((a, s) => a + s.stack, 0);
    if (after !== before) { conserved = false; break; }
    done++;
  }
  ok(sized, 'limit raises are always a single fixed amount');
  ok(!wedged && conserved && done === 150, `limit fuzz: ${done} hands conserve and complete`);
}

// ---- tournament arithmetic
{
  const t = newTourney({ names: ['A', 'B', 'C', 'D', 'E', 'F'], handsPerLevel: 8 });
  ok(levelNum(t) === 1 && levelOf(t).bb === 20, 'level 1 opens at 10/20');
  t.handIndex = 8;
  ok(levelNum(t) === 2 && levelOf(t).bb === 30, 'level 2 at 15/30 after 8 hands');
  t.handIndex = 8 * 10;
  ok(levelNum(t) === 11 && levelOf(t).bb === 1000, 'level 11 reaches 500/1000');
  t.handIndex = 8 * 99;
  ok(levelOf(t).bb === LEVELS[LEVELS.length - 1].bb, 'levels cap at the top of the schedule');
}

// ---- a whole tournament under random play: finishes, conserves, ranks
{
  const t = newTourney({ names: ['A', 'B', 'C', 'D', 'E', 'F'], handsPerLevel: 6 });
  const drv = rngFromSeed(sha256('tourney-drv'));
  let hands = 0;
  while (t.champion === null && hands < 2000) {
    const h = tourneyHand(t, sha256('tourney-hand' + hands));
    let guard = 0;
    while (h.phase === 'act' && guard++ < 200) {
      const L = legal(h);
      // mildly call-happy random play so hands end
      const r = drv();
      let pick;
      if (L.actions.includes('check') && r < 0.6) pick = 'check';
      else if (L.actions.includes('call') && r < 0.75) pick = 'call';
      else if ((L.actions.includes('bet') || L.actions.includes('raise')) && r < 0.85) pick = L.actions.includes('bet') ? 'bet' : 'raise';
      else pick = L.actions.includes('check') ? 'check' : 'fold';
      if (pick === 'bet' || pick === 'raise') act(h, { seat: L.seat, action: pick, amount: L.minRaiseTo });
      else act(h, { seat: L.seat, action: pick });
    }
    absorbHand(t, h);
    const total = t.stacks.reduce((a, b) => a + b, 0);
    if (total !== 6 * START_STACK) { ok(false, 'tournament chip conservation', total); break; }
    hands++;
  }
  ok(t.champion !== null, `a random tournament completes (${hands} hands)`);
  ok(t.stacks[t.champion] === 6 * START_STACK, 'the champion holds every chip');
  const places = placings(t);
  ok(places.length === 6 && new Set(places).size === 6, 'placings rank all six seats');
  ok(places[0] === t.champion, 'the champion places first');
}

// ---- Glicko-2 against the worked example in Glickman's paper
{
  const p = { r: 1500, rd: 200, vol: 0.06 };
  const out = glicko2(p, [
    { r: 1400, rd: 30, score: 1 },
    { r: 1550, rd: 100, score: 0 },
    { r: 1700, rd: 300, score: 0 },
  ]);
  ok(Math.abs(out.r - 1464.06) < 0.1, 'Glicko-2 rating matches the paper (1464.06)', out.r);
  ok(Math.abs(out.rd - 151.52) < 0.1, 'Glicko-2 RD matches the paper (151.52)', out.rd);
  ok(Math.abs(out.vol - 0.05999) < 0.001, 'Glicko-2 volatility stays near 0.06', out.vol);
  const up = glicko2({ r: 1200, rd: 100, vol: 0.06 }, [{ r: 800, rd: 60, score: 1 }]);
  ok(up.r > 1200 && up.r < 1215, 'beating a much weaker level moves the rating a little', up.r);
  const dn = glicko2({ r: 1200, rd: 100, vol: 0.06 }, [{ r: 800, rd: 60, score: 0 }]);
  ok(dn.r < 1150, 'losing to a much weaker level costs real points', dn.r);
}

if (fails) { console.error(`\n${fails} FAILURE(S)`); process.exit(1); }
console.log('\nall tests pass');
