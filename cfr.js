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
      const u = cfr(hist + acts[a], cards,
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
      for (let a = 0; a < acts.length; a++) u += strat[a] * walk(hist + acts[a], cards);
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
