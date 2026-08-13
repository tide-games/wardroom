// cfr.js — counterfactual regret minimization, the solver family behind
// modern poker AI, at fleet scale. Pure and dependency-free. This file is the
// trainer skeleton for the ladder's upper rungs: prove it on Kuhn poker
// (known solution), then Leduc, then abstracted heads-up limit hold'em.
//
// A Game is a plain object:
//   numPlayers        — 2
//   deals()           — array of {cards, weight}: chance outcomes to enumerate
//   isTerminal(hist, cards)
//   utility(hist, cards)      — terminal payoff for PLAYER 0 (zero-sum)
//   player(hist)              — whose turn (0|1) at a non-terminal history
//   infoset(hist, cards)      — the acting player's information-set key
//   actions(hist)             — legal action labels at this history
// Histories are strings of action characters; '' is the root after the deal.

export function newSolver(game) {
  const regret = new Map();      // infoset -> number[] (per action)
  const strategySum = new Map(); // infoset -> number[] (avg strategy accum)

  const zeros = (n) => new Array(n).fill(0);
  const get = (map, key, n) => {
    let v = map.get(key);
    if (!v) { v = zeros(n); map.set(key, v); }
    return v;
  };

  // regret matching: positive regrets, normalized; uniform when none
  function strategyOf(key, n) {
    const r = get(regret, key, n);
    let sum = 0;
    const s = r.map((x) => { const p = x > 0 ? x : 0; sum += p; return p; });
    return sum > 0 ? s.map((x) => x / sum) : zeros(n).fill(1 / n);
  }

  const step = (h, a) => (game.next ? game.next(h, a) : h + a);

  // one vanilla CFR pass for one deal; returns utility for player 0
  function cfr(hist, cards, reach0, reach1) {
    if (game.isTerminal(hist, cards)) return game.utility(hist, cards);
    const p = game.player(hist);
    const acts = game.actions(hist);
    const key = game.infoset(hist, cards);
    const strat = strategyOf(key, acts.length);
    const utils = new Array(acts.length);
    let nodeUtil = 0;
    for (let a = 0; a < acts.length; a++) {
      const u = cfr(step(hist, acts[a]), cards,
        p === 0 ? reach0 * strat[a] : reach0,
        p === 1 ? reach1 * strat[a] : reach1);
      utils[a] = u;
      nodeUtil += strat[a] * u;
    }
    // regret update, from the acting player's perspective
    const r = get(regret, key, acts.length);
    const ss = get(strategySum, key, acts.length);
    const myReach = p === 0 ? reach0 : reach1;
    const oppReach = p === 0 ? reach1 : reach0;
    const sign = p === 0 ? 1 : -1;
    for (let a = 0; a < acts.length; a++) {
      r[a] += oppReach * sign * (utils[a] - nodeUtil);
      ss[a] += myReach * strat[a];
    }
    return nodeUtil;
  }

  function iterate(n = 1) {
    let total = 0, weightSum = 0;
    for (let i = 0; i < n; i++) {
      for (const { cards, weight } of game.deals()) {
        total += weight * cfr('', cards, 1, 1);
        weightSum += weight;
      }
    }
    return total / weightSum;
  }

  // the convergent object: normalized average strategy per infoset
  function averageStrategy() {
    const out = {};
    for (const [key, ss] of strategySum) {
      const sum = ss.reduce((a, b) => a + b, 0);
      out[key] = sum > 0 ? ss.map((x) => x / sum) : ss.map(() => 1 / ss.length);
    }
    return out;
  }

  // expected utility for player 0 when both play the average strategy
  function valueOf(avg) {
    function walk(hist, cards) {
      if (game.isTerminal(hist, cards)) return game.utility(hist, cards);
      const acts = game.actions(hist);
      const key = game.infoset(hist, cards);
      const strat = avg[key] || acts.map(() => 1 / acts.length);
      let u = 0;
      for (let a = 0; a < acts.length; a++) u += strat[a] * walk(game.next ? game.next(hist, acts[a]) : hist + acts[a], cards);
      return u;
    }
    let total = 0, weightSum = 0;
    for (const { cards, weight } of game.deals()) {
      total += weight * walk('', cards);
      weightSum += weight;
    }
    return total / weightSum;
  }

  return { iterate, averageStrategy, valueOf };
}

// Best response: the value a perfect exploiter earns against `avg` when
// playing seat `player` — computed exactly, per information set (the
// exploiter maximizes over actions using opponent-reach-weighted values,
// never per-deal clairvoyance). exploitability -> 0 at equilibrium: the
// honest convergence gate, no remembered constants required.
export function bestResponse(game, avg, player) {
  const step = (h, a) => (game.next ? game.next(h, a) : h + a);
  const deals = game.deals();
  const totalW = deals.reduce((a, d) => a + d.weight, 0);
  const uniform = (n) => new Array(n).fill(1 / n);

  // enumerate the exploiter's decision nodes with opponent reach
  const groups = new Map(); // infoset -> {hist-depth, members: [{hist, cards, weight, oppReach}], acts}
  function enumerate(hist, cards, weight, oppReach) {
    if (game.isTerminal(hist, cards)) return;
    const p = game.player(hist);
    const acts = game.actions(hist);
    if (p === player) {
      const key = game.infoset(hist, cards);
      let g = groups.get(key);
      if (!g) { g = { depth: hist.length, members: [], acts }; groups.set(key, g); }
      g.depth = Math.max(g.depth, hist.length);
      g.members.push({ hist, cards, weight, oppReach });
      for (const a of acts) enumerate(step(hist, a), cards, weight, oppReach);
    } else {
      const strat = avg[game.infoset(hist, cards)] || uniform(acts.length);
      for (let a = 0; a < acts.length; a++) {
        if (strat[a] > 0) enumerate(step(hist, acts[a]), cards, weight, oppReach * strat[a]);
      }
    }
  }
  for (const { cards, weight } of deals) enumerate('', cards, weight, 1);

  // resolve choices deepest-first; value() only ever descends, so children's
  // infosets are already decided when a shallower group is scored
  const choice = new Map();
  const memo = new Map();
  function value(hist, cards) {           // exploiter's perspective
    if (game.isTerminal(hist, cards)) {
      return game.utility(hist, cards) * (player === 0 ? 1 : -1);
    }
    const mkey = hist + '#' + cards.join(',');
    if (memo.has(mkey)) return memo.get(mkey);
    const p = game.player(hist);
    const acts = game.actions(hist);
    let v;
    if (p === player) {
      const a = choice.get(game.infoset(hist, cards));
      v = value(step(hist, acts[a]), cards);
    } else {
      const strat = avg[game.infoset(hist, cards)] || uniform(acts.length);
      v = 0;
      for (let a = 0; a < acts.length; a++) {
        if (strat[a] > 0) v += strat[a] * value(step(hist, acts[a]), cards);
      }
    }
    memo.set(mkey, v);
    return v;
  }
  const ordered = [...groups.entries()].sort((x, y) => y[1].depth - x[1].depth);
  for (const [key, g] of ordered) {
    let best = -Infinity, bestA = 0;
    for (let a = 0; a < g.acts.length; a++) {
      let sum = 0;
      for (const m of g.members) sum += m.weight * m.oppReach * value(step(m.hist, g.acts[a]), m.cards);
      if (sum > best) { best = sum; bestA = a; }
    }
    choice.set(key, bestA);
    // invalidate memo entries at or above this depth? not needed: value()
    // below only consulted children (deeper choices), and this group's own
    // nodes were never evaluated through value() yet
  }
  let total = 0;
  for (const { cards, weight } of deals) total += weight * value('', cards);
  return total / totalW;
}
export function exploitability(game, avg) {
  return bestResponse(game, avg, 0) + bestResponse(game, avg, 1);
}

// ---------------------------------------------------------------- Kuhn poker
// Three cards (J=0, Q=1, K=2), one each, ante 1. Check/bet(1); facing a bet:
// call/fold. The oldest solved poker game: value to player 0 is exactly -1/18.
export const KUHN = {
  numPlayers: 2,
  deals() {
    const out = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      if (a !== b) out.push({ cards: [a, b], weight: 1 });
    }
    return out;
  },
  isTerminal(h) {
    return h === 'cc' || h === 'bc' || h === 'bf' || h === 'cbc' || h === 'cbf';
  },
  utility(h, cards) {
    const hi = cards[0] > cards[1] ? 1 : -1;   // showdown sign for player 0
    switch (h) {
      case 'cc': return hi;                     // ante only
      case 'bc': return 2 * hi;                 // bet called
      case 'cbc': return 2 * hi;
      case 'bf': return 1;                      // P1 folds to P0's bet
      case 'cbf': return -1;                    // P0 folds to P1's bet
      default: throw new Error('not terminal: ' + h);
    }
  },
  player(h) { return h.length % 2; },
  infoset(h, cards) { return 'JQK'[cards[this.player(h)]] + '|' + h; },
  actions(h) { return h.endsWith('b') ? ['c', 'f'] : ['c', 'b']; }, // c=check/call, b=bet, f=fold
};

// ---------------------------------------------------------------- Leduc poker
// Six cards (J,Q,K in two suits), one each, ante 1; one board card after the
// first round. Bets fixed at 2 (round 1) and 4 (round 2), max two raises per
// round. Pairing the board wins. The second correctness gate.
const LEDUC_CARDS = [0, 0, 1, 1, 2, 2];    // ranks; suits don't matter beyond pairing
function leducRound(hist) {                 // split history at the board marker
  const i = hist.indexOf('/');
  return i === -1 ? [hist, null] : [hist.slice(0, i), hist.slice(i + 1)];
}
function roundOver(r) {
  // r is a round's action string over k(check/call) b/r, terminated states:
  return r === 'kk' || r.endsWith('bk') || r.endsWith('rk') ||
         (r.length >= 2 && r.endsWith('k') && r !== 'k' && r[r.length - 2] !== undefined && (r[r.length - 2] === 'b' || r[r.length - 2] === 'r'));
}
function leducContrib(hist) {
  // returns [c0, c1, folded(-1 none | player), roundsDone]
  let c = [1, 1];                            // antes
  const [r1, r2] = leducRound(hist);
  let folded = -1;
  for (const [round, bet] of [[r1, 2], [r2 === null ? '' : r2, 4]]) {
    if (round === '' && bet === 4 && r2 === null) break;
    let actor = 0, level = [0, 0];
    for (const ch of round) {
      if (ch === 'f') { folded = actor; break; }
      if (ch === 'b' || ch === 'r') { level[actor] = level[1 - actor] + bet; }
      if (ch === 'k') { level[actor] = level[1 - actor]; }
      actor = 1 - actor;
    }
    c[0] += level[0]; c[1] += level[1];
    if (folded !== -1) break;
  }
  return [c[0], c[1], folded];
}
export const LEDUC = {
  numPlayers: 2,
  deals() {
    const out = [];
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
      if (a === b) continue;
      for (let d = 0; d < 6; d++) {
        if (d === a || d === b) continue;
        out.push({ cards: [LEDUC_CARDS[a], LEDUC_CARDS[b], LEDUC_CARDS[d]], weight: 1 });
      }
    }
    return out;
  },
  _roundState(hist) {
    // returns {round: 0|1, r: activeRoundString, done, folded}
    const [r1, r2] = leducRound(hist);
    const parse = (round, bet) => {
      let raises = 0, pending = false, actor = 0, folded = -1, acted = 0;
      for (const ch of round) {
        if (ch === 'f') { folded = actor; }
        if (ch === 'b' || ch === 'r') { raises++; pending = true; }
        if (ch === 'k') { pending = false; }
        actor = 1 - actor; acted++;
      }
      const over = folded !== -1 || (acted >= 2 && !pending);
      return { raises, pending, actor, folded, over };
    };
    if (r2 === null) {
      const st = parse(r1, 2);
      return { round: 0, ...st };
    }
    const st = parse(r2, 4);
    return { round: 1, ...st };
  },
  isTerminal(hist) {
    const st = this._roundState(hist);
    if (st.folded !== -1) return true;
    return st.round === 1 && st.over;
  },
  utility(hist, cards) {
    const [c0, c1, folded] = leducContrib(hist);
    if (folded === 0) return -c0;
    if (folded === 1) return c1;
    // showdown: pair the board wins, else high card, tie splits
    const [a, b, board] = cards;
    const ra = a === board ? 10 + a : a;
    const rb = b === board ? 10 + b : b;
    if (ra === rb) return 0;
    return ra > rb ? c1 : -c0;
  },
  player(hist) {
    return this._roundState(hist).actor;
  },
  infoset(hist, cards) {
    const st = this._roundState(hist);
    const me = cards[this.player(hist)];
    const board = st.round === 1 ? cards[2] : -1;
    return `${'JQK'[me]}${board >= 0 ? '/' + 'JQK'[board] : ''}|${hist}`;
  },
  actions(hist) {
    const st = this._roundState(hist);
    if (st.pending) return st.raises < 2 ? ['k', 'r', 'f'] : ['k', 'f']; // call/raise/fold
    return ['k', 'b'];                                                   // check/bet
  },
  // the game's own street-advance: after round 0 closes, insert '/'
  next(hist, a) {
    const h2 = hist + a;
    const st = this._roundState(h2);
    if (st.round === 0 && st.folded === -1 && st.over) return h2 + '/';
    return h2;
  },
};
