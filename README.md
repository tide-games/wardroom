# The Wardroom 🃏

**Play: https://tide-games.github.io/wardroom/** — tournament poker in the
officers' mess.

A six-handed **no-limit Texas hold'em sit & go**: you and five of the ship's
characters, 10,000 chips each, blinds climbing every 8 hands through a
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
equity against pot odds postflop, push/fold under ten big blinds — and every
decision is made from the bot's **own two cards only** (the per-seat view in
`seatView()`), never from yours.

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

Every shuffle is seeded: hand seeds derive from the tournament seed
(`sha256(tourneySeed|hand|N)`), each hand's seed is printed in the hand
history as it completes, and the same seed + the same actions replays the same
hand from [the source](poker.js). This is a practice room against bots that
run in your own browser — play chips, nothing staked. **Multi-user is the next
voyage**: the engine already speaks per-seat views and serializable actions,
which is exactly the seam remote players plug into.

A [tide-games](https://tide-games.github.io/) boat, built in the fleet
playbook: one owner, ten critic rounds, everything gh-pages.
