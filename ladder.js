// ladder.js — the shared abstraction for heads-up fixed-limit hold'em: the
// same code buckets hands for the trainer (node) and the ladder bot
// (browser), so the strategy table always means what it meant in training.
import { rankOf, suitOf, evaluate } from './poker.js';

// ---------------------------------------------------------------- preflop
// Canonical 169: pairs, suited, offsuit — exact, no abstraction loss.
export function preflopIndex(hole) {
  const r1 = rankOf(hole[0]), r2 = rankOf(hole[1]);
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const suited = suitOf(hole[0]) === suitOf(hole[1]);
  if (hi === lo) return hi;                          // 0..12 pairs
  const off = hi * (hi - 1) / 2 + lo;                // 0..77 per shape
  return 13 + (suited ? 0 : 78) + off;               // 13..90 suited, 91..168 offsuit
}

// ---------------------------------------------------------------- postflop
// Deterministic feature bucket: made-hand class × strength-within-class ×
// draws. Cheap (microseconds), stable, and identical at train and play time.
export function bucketOf(hole, board) {
  const cards = [...hole, ...board];
  const ev = evaluate(cards);
  const boardEv = board.length >= 5 ? evaluate(board) : null;
  const holeRanks = hole.map(rankOf);
  const boardRanks = board.map(rankOf);
  const boardMax = Math.max(...boardRanks);

  // strength-within-class, 0..3 (higher = stronger)
  let sub = 0;
  if (ev.cat === 0) {                                 // high card
    const hi = Math.max(...holeRanks);
    sub = hi === 12 ? 2 : hi >= 10 ? 1 : 0;
  } else if (ev.cat === 1) {                          // one pair
    const pr = ev.kick[0];
    const usesHole = holeRanks.includes(pr);
    if (!usesHole) sub = 0;                           // board pair
    else if (pr > boardMax) sub = 3;                  // overpair
    else if (pr === boardMax) sub = 2;                // top pair
    else sub = 1;                                     // middle/under
  } else if (ev.cat === 2) {                          // two pair
    sub = holeRanks.includes(ev.kick[0]) ? (holeRanks.includes(ev.kick[1]) ? 3 : 2) : 1;
  } else if (ev.cat === 3) {                          // trips/set
    sub = holeRanks[0] === holeRanks[1] ? 3 : 2;      // set beats trips
  } else {
    // straight+ : how much of it is ours (board-made hands are weaker holdings)
    sub = boardEv && boardEv.cat >= ev.cat ? 1 : 3;
  }

  // draws (only meaningful before the river)
  let flushDraw = 0, straightDraw = 0;
  if (board.length < 5) {
    const suitCount = [0, 0, 0, 0];
    for (const c of cards) suitCount[suitOf(c)]++;
    for (let s = 0; s < 4; s++) {
      if (suitCount[s] === 4 && hole.some((c) => suitOf(c) === s)) flushDraw = 1;
    }
    const present = new Set(cards.map(rankOf));
    if (present.has(12)) present.add(-1);             // wheel ace
    for (let lo = -1; lo <= 8 && !straightDraw; lo++) {
      let have = 0, holeIn = false;
      for (let r = lo; r < lo + 5; r++) {
        if (present.has(r)) { have++; if (holeRanks.includes(r)) holeIn = true; }
      }
      if (have === 4 && holeIn && ev.cat < 4) straightDraw = 1;
    }
  }
  return ev.cat * 16 + sub * 4 + flushDraw * 2 + straightDraw;   // 0..143
}

// street bucket key: preflop uses the exact 169, postflop the feature bucket
export function streetBucket(street, hole, board) {
  return street === 0 ? preflopIndex(hole) : bucketOf(hole, board.slice(0, street === 1 ? 3 : street === 2 ? 4 : 5));
}

// ---------------------------------------------------------------- the game
// Heads-up fixed-limit betting walker used by the trainer — a lean mirror of
// poker.js's limit rules (bb=2 units; big bets on turn/river; 4-bet cap with
// the big blind counting preflop; button posts sb=1, acts first preflop,
// last postflop).
export const HU = {
  SB: 1, BB: 2,
  betSize(street) { return street <= 1 ? 2 : 4; },
  // state: {street, hist: per-street strings joined later, roundStr, bets,
  //   toCall, contrib:[a,b], actor, folded, done}
  initial() {
    return {
      street: 0, rounds: ['', '', '', ''], bets: 1, toCall: 1,
      contrib: [1, 2], actor: 0, folded: -1, done: false,
    };
  },
  actions(st) {
    const acts = [];
    if (st.toCall > 0) { acts.push('k'); if (st.bets < 4) acts.push('b'); acts.push('f'); }
    else { acts.push('k'); if (st.bets < 4) acts.push('b'); }
    return acts; // k = check/call, b = bet/raise, f = fold
  },
  apply(st, a) {
    const s = { ...st, rounds: [...st.rounds], contrib: [...st.contrib] };
    s.rounds[s.street] += a;
    const other = 1 - s.actor;
    if (a === 'f') { s.folded = s.actor; s.done = true; return s; }
    if (a === 'k') {
      s.contrib[s.actor] += s.toCall;
      const acted = s.rounds[s.street].length;
      const closes = s.toCall > 0 ? true : acted >= 2;
      s.toCall = 0;
      if (closes) {
        if (s.street === 3) { s.done = true; return s; }
        s.street++; s.bets = 0; s.toCall = 0;
        s.actor = 1;                     // postflop: BB (non-button) first
        return s;
      }
      s.actor = other;
      return s;
    }
    // bet/raise
    const bet = this.betSize(s.street);
    s.contrib[s.actor] += s.toCall + bet;
    s.toCall = bet;
    s.bets++;
    s.actor = other;
    return s;
  },
  infoset(st, hole, board) {
    const b = streetBucket(st.street, hole, board);
    return st.street + '|' + b + '|' + st.rounds.slice(0, st.street + 1).join('/');
  },
  utility(st, holes, board) {           // for player 0 (the button)
    if (st.folded === 0) return -st.contrib[0];
    if (st.folded === 1) return st.contrib[1];
    const s0 = evaluate([...holes[0], ...board]).score;
    const s1 = evaluate([...holes[1], ...board]).score;
    if (s0 === s1) return 0;
    return s0 > s1 ? st.contrib[1] : -st.contrib[0];
  },
};

// ---------------------------------------------------------------- the bot
// Play a strategy table (infoset -> [probs]) inside a live poker.js hand.
export function historyRounds(h) {
  // rebuild per-street 'k/b/f' strings from the hand log (blinds excluded)
  const rounds = ['', '', '', ''];
  let street = 0;
  for (const e of h.log) {
    if (e.ev === 'street') { street = ['preflop', 'flop', 'turn', 'river'].indexOf(e.street); continue; }
    if (e.ev === 'fold') rounds[street] += 'f';
    else if (e.ev === 'check' || e.ev === 'call') rounds[street] += 'k';
    else if (e.ev === 'bet' || e.ev === 'raise') rounds[street] += 'b';
  }
  return rounds;
}
export function ladderDecide(h, seat, L, table, epsilon, rng) {
  const rounds = historyRounds(h);
  const street = h.street;
  const bucket = streetBucket(street, h.seats[seat].hole, h.board);
  const key = street + '|' + bucket + '|' + rounds.slice(0, street + 1).join('/');
  const probsRaw = table ? table[key] : null;
  const acts = [];                                  // mirror trainer's k/b/f
  if (L.callAmount > 0) { acts.push('k'); if (L.actions.includes('raise') || L.actions.includes('bet')) acts.push('b'); acts.push('f'); }
  else { acts.push('k'); if (L.actions.includes('bet') || L.actions.includes('raise')) acts.push('b'); }
  let probs = probsRaw && probsRaw.length === acts.length ? [...probsRaw] : acts.map(() => 1 / acts.length);
  if (epsilon > 0) probs = probs.map((p) => (1 - epsilon) * p + epsilon / probs.length);
  // sample
  let x = rng(), pick = 0;
  for (let i = 0; i < probs.length; i++) { x -= probs[i]; if (x <= 0) { pick = i; break; } }
  const chosen = acts[Math.min(pick, acts.length - 1)];
  if (chosen === 'f') {
    // never fold when checking is free
    if (L.callAmount === 0) return { seat, action: 'check' };
    return { seat, action: 'fold' };
  }
  if (chosen === 'k') return { seat, action: L.callAmount > 0 ? 'call' : 'check' };
  const action = L.actions.includes('bet') ? 'bet' : 'raise';
  return { seat, action, amount: L.minRaiseTo };
}
