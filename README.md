# The Wardroom 🃏

**Play: https://tide-games.github.io/wardroom/** — tournament poker in the
officers' mess.

A six-handed **no-limit Texas hold'em sit & go**: you and five of the ship's
characters, 1,500 chips each (~75 big blinds), blinds climbing every 8 hands through a
15-level schedule, last sailor holding chips takes the pennant.

## The table

| | style |
|---|---|
| 🎖 **Cmdr. Sterling** | a rock — waits for the navy |
| 🪶 **First Mate Wren** | tight, then ruthless |
| 💣 **Gunner Halloway** | pressure from any two cards |
| 🍲 **Cook Barnacle** | never folds a stew |
| 🐧 **Ensign Puffin** | all sail, no anchor |

Each bot plays its printed nature: Chen-formula preflop charts, Monte-Carlo
equity against pot odds postflop, push/fold under ten big blinds. Bots decide
from the per-seat view (`seatView()`), which hides every other seat's cards —
a discipline enforced at the call site and pinned by the view-privacy tests,
though bots and deck do share the page: structural isolation (a Worker fed
only the serialized view) is on the list.

## A real engine

[`poker.js`](poker.js) is a pure state machine driven by serializable messages
(`{seat, action, amount}`) — and it does the two things amateur poker engines
get wrong, by the book:

- **The min-raise law**, including the under-raise all-in that does *not*
  reopen the betting for players who already acted.
- **Exact side pots** built from capped commitments — uncalled bets refunded,
  dead money from big folders folded into the right pot, odd chips to the
  first winner past the button.

Plus heads-up button rules (button posts the small blind, acts first preflop,
last after), antes from level 5, and eliminations ranked by the official
convention (simultaneous busts rank by starting stack).

[`tests.js`](tests.js) proves it: an evaluator torture rack (wheel straights,
kickers, two-trips full houses, board-plays chops), scripted min-raise and
side-pot hands, and a **400-hand random-legal-action fuzz** plus full random
tournaments asserting chips conserve to the exact chip, every hand, forever.
The fuzzer earned its keep during the build: it caught a genuine side-pot leak
(a folded player's excess dying between pot slices) that scripted tests missed.

[`soak.js`](soak.js) runs whole bot tournaments headless — 600 tourneys,
65,000+ hands, no wedges, no leaks, and a sane skill ordering (the rock
outlasts the maniac).

## Fairness, honestly

Every shuffle is **committed before it's dealt**: the hand history prints
`sha256(seed)` at the deal and reveals the seed only when the hand ends, so
anyone can check the deck was fixed before a single card was seen. Hand seeds
derive from the tournament seed (`sha256(tourneySeed|hand|N)`), which is
itself committed at the start and revealed when the tournament ends; the same
seed + the same actions replays the same hand from [the source](poker.js).

Said plainly, like [the Jack](https://github.com/tide-games/jack) says it:
this is a **client-side practice room** — the deck, the dealer, and the bots
all run in your own browser, so a determined player can always read their own
machine's memory. The commitment scheme keeps the honest game honest; it does
not make staked play defensible. Sealed stakes would need a server-side
dealer and the stake-witnessing rule of
[tideholm #154](https://github.com/melvincarvalho/tideholm/issues/154) —
that's the bar, and this room hasn't met it yet. Multi-user needs a
deck-secrecy design first (who shuffles, who holds the deck mid-hand); the
per-seat views and serializable actions are the seam it will plug into, not
the whole answer.

## The ladder (in progress)

The destination is a lichess-style skill ladder for **heads-up fixed-limit
hold'em** — the one poker variant whose heads-up form has been essentially
solved (Cepheus, 2015), which is exactly why an honest browser-scale ladder
can exist for it:

- **Level 1 — the characters** (live): the personality bots.
- **Levels 2–7 — the ladder** (planned): a real CFR-trained strategy for
  abstracted heads-up limit, diluted with increasing noise as you go down.
- **The chart room** (planned): lichess-style review — every decision graded
  against the trained strategy's mix, EV-loss per choice, accuracy per match.

The plumbing is landing bottom-up and is verifiable at each step:
[`poker.js`](poker.js) speaks **fixed-limit** now (fixed bet units, big bets
on turn/river, the four-bet cap — tested including a limit fuzz), and
[`cfr.js`](cfr.js) + [`train.js`](train.js) are the solver core —
counterfactual regret minimization, currently **verified against Kuhn
poker's known analytic solution** (game value converges to −1/18 to six
decimal places; the classic 1/3 bluffing and calling frequencies emerge on
their own). Next: Leduc, then bucketed heads-up limit.

A [tide-games](https://tide-games.github.io/) boat, built in the fleet
playbook: one owner, ten critic rounds, everything gh-pages.
