# The Wardroom Ledger — rated play for humans and bots

*A design for a lichess-shaped rating pool where every number is backed by a
replayable proof instead of platform trust. Spec before code, in the fleet
tradition; the trail's design (tideholm's TRAIL.md) is this document's
closest relative — matches are a signed chain, and the chain is the honesty.*

## 1. Goals and non-goals

**Goals:** one comparable pool for humans and bots; ratings that converge on
skill rather than card luck; every published number recomputable by a
stranger from signed transcripts; the fleet's identity (nostr keys) and
hosting (static pages) throughout.

**Non-goals (v1):** human-vs-human rated play (blocked on the deck-secrecy
protocol); proving *who was driving* (solver-in-another-window is
undetectable on every poker site ever built — we declare this on the page
and flag statistical anomalies instead of pretending).

## 2. The two metrics [CORE]

Poker match outcomes are luck-soaked in a way chess games are not: a
40-hand heads-up match between unequal players is close to a coin flip, so
a match-only rating needs dozens of results to see through the cards. But
the Wardroom has ground truth per *decision* — solved preflop, trained
flop/turn, exactly solved rivers. So there are two numbers, each updating
at its natural rhythm:

| | ⚡ **Rating** | 🎯 **Leak** |
|---|---|---|
| Updates | per match | per decision |
| Estimator | Glicko-2 (implemented, verified against Glickman's worked example) | EV-weighted deviation from the reference strategy, in **bb/100** |
| Measures | results vs the anchored ladder | decision quality, luck-free |
| Converges | slowly (luck noise) | in an evening |
| Role | the number you compete on | the number you train on |

The leak is denominated in the same currency as every other measurement in
this repo — Cepheus is ~0.1 bb/100 from perfect, our bot ~1–4 (estimated),
peak humans ~1–5 (estimated) — so a player's leak sits directly on the
same scale. EV weighting matters: in mixed spots the off-frequency action
often costs ~nothing, while one bad river call costs eight big bets.
River EV loss is exact (the subgame solver already computes counterfactual
values; expose them). Preflop/flop/turn carry frequency-weighted proxies
until better values exist, and are labeled as proxies.

**Level promotion gates on leak, not match wins** — skill, not variance.

## 2b. Rated and casual [LIVE in v0]

Lichess's split, taken further: **casual** allows every tool (hints, coach,
any level, replays) and never touches a rating or a chain. **Rated**
disables in-game assistance entirely — the bulb and the coach are not
merely flagged but *unavailable* — so a rated transcript claims unaided
play by construction, and the hintFlags field exists only for the casual
analytics path. Rated is opt-in per match; the chain (§4) records rated
matches only. The room already implements the split ahead of the Ledger:
a 🏅/☕ toggle, assistance stripped in rated, rating movement gated on it.
The anomaly flag (§8) remains necessary regardless: external solvers are
invisible to any client.

## 3. Identity

A nostr keypair (xlogin, as everywhere in the fleet). Ratings and chains
belong to an npub. Pseudonymous by default.

## 3b. Declared agents — bots as first-class citizens [CORE]

The lichess BOT flag, adopted whole: an identity may declare itself an
agent (`agent: {name, version, tableHash}` in its transcripts), and
declared bots are welcome — own ratings in the same Glicko pool, marked
everywhere they appear, choosable opponents for humans who want the
challenge, and eligible for **bot-vs-bot leagues**: the successor to the
dead Annual Computer Poker Championship, better instrumented than the
original — every entrant's brain is pinned by hash, every match
replayable, every career anchored. The ladder's own levels 2–7 are the
founding citizens of this class.

Why a bot self-declares: declaration is the only road to what bot authors
want — to play openly, to rank, to publish a named, versioned,
reproducible career. Lying buys a short human-masquerade that the anomaly
flag (§8) prices against an anchored trail (§6b) months in the making.
The system is trust-based because honesty is the profitable strategy,
not because anyone is naive.

Human-vs-bot rated play is consensual and marked on both careers; boards
default to filtering classes apart, one toggle to mix them.

## 4. The match chain — anti-cherry-pick [CORE]

Self-chosen seeds + publish-only-wins would make any leaderboard fiction.
So rated matches form a hash chain per identity:

```
seed_n = sha256(npub | n | sha256(transcript_{n-1}))      (seed_1 from npub | 1)
```

The next match's shuffle is determined by the previous match's transcript.
Consequences: no grinding seeds for a winnable deck; no silently dropping a
loss (the next seed would fail verification); an abandoned match is a
visible gap and scores as a forfeit. **Publish-or-break-chain.** Casual and
practice play stay entirely outside the chain — the chain exists only when
you opt into rated.

Single-writer discipline applies (one chain, one device at a time), same as
trails. Cross-device continuation moves the chain state, not copies it.

## 5. The transcript

Small, signed, self-contained:

```json
{ "npub": "…", "n": 17, "level": 6,
  "tableHash": "sha256 of strategy-hulimit.json",
  "codeVersion": "git commit of the bot",
  "seedCommit": "sha256(seed) — committed before play, revealed after",
  "actions": ["…every hero action, in order…"],
  "hintFlags": [/* per-decision: unaided | hinted | coached */],
  "result": { "win": true, "hands": 41 },
  "sig": "BIP-340 over the canonical form" }
```

Determinism requirements it pins: the bot's brain (table hash), the bot's
rng derivation (code version), and the seed chain. A verifier replays the
entire match from the transcript alone — bot decisions are a pure function
of seed + table, so the claimed result either reproduces or it doesn't.
Both metrics are recomputable from the same transcript.

## 6. Anchors

Bot levels carry fixed ratings (Lv2 = 800 … Lv7 = 1800) — the shared
yardstick that makes two strangers' numbers comparable, as Stockfish levels
do for lichess. Fixed in v1; recalibrating anchors from aggregate results
is a v2 governance question, deliberately deferred.

## 6b. Anchored careers — identity age as the anti-bot economics [CORE]

Bots cannot be detected; they can only be made expensive. The one asset a
bot farm cannot counterfeit is **time** — and the fleet already ships the
machinery that proves it. The match chain (§4) feeds the tidegate anchor
exactly as Tideholm trails do: periodically, the head of an identity's
match chain is committed to Bitcoin. A career becomes **timestamped in
blocks** — "the first 500 rated matches of this npub were anchored in
March" is verifiable by strangers and impossible to backdate. Sybils stay
free to create and worthless to keep: a naked trail is legible at a glance.

**The profile is the product**: rated hands and when they were anchored,
leak drifting downward the way humans learn, session rhythms, vouches
(signed links from other trails), every line recomputable from public
transcripts. Opponent *selection* replaces matchmaking — the home-game
model: you play trails you can read, not strangers who might be GPUs.

The residual hole, named plainly: an aged human account handed to a bot
(poker's eternal account-selling problem). The trail narrows it to a
**discontinuity against the identity's own anchored baseline** — leak
collapsing to solver-level, rhythm changes — which the anomaly flag (§8)
scores against history the identity cannot rewrite. Evading the flag means
abandoning the trail; cheating costs the only asset that can't be re-bought.

Combined with §2b and §8, the stack is: rake-free (protocol, no house),
provably fair (commit-reveal + replayable transcripts), reputation accruing
on Bitcoin time (anchored trails), and consent-based matching (the graph).
Bots get economics, not detection theater.

## 7. Transport and the board

Transcripts publish as signed nostr events. A static leaderboard page
(gh-pages, in the blocktrails ethos) aggregates them, **recomputes every
rating and leak from scratch client-side**, and offers a per-match verify
button that replays the transcript in the page. No server owns the truth;
mirrors are conveniences.

## 8. Honesty posture [NORMATIVE]

Stated on the board itself:

- Transcripts prove **what happened**, not **who was driving**.
- Hint/coach use is self-declared per decision and excluded from leak and
  accuracy; a transcript that declares nothing claims unaided play.
- **The anomaly flag:** a sustained leak below what the best measured
  humans achieve (threshold: leak < ~2 bb/100 over 500+ unaided decisions)
  is *solver-consistent play*. The board does not accuse; it annotates —
  such entries carry a visible ⚠ badge and are excluded from the default
  ranking view. The bot's own published leak-vs-reference (≈0 by
  construction) calibrates the threshold. Statistical, transparent,
  recomputable by anyone — the flag itself is derived from the public
  transcripts, never from hidden moderation.
- Sybils are cheap (keys are free). The chain makes each identity's record
  internally honest; it cannot make identities scarce. Rankings therefore
  emphasize record depth (rating ± deviation, chain length, leak sample
  size, **anchor age** — §6b) over raw rating.
- The anomaly flag also watches for **baseline discontinuities** on a single
  identity (§6b): a career whose leak steps from human to solver-grade
  between anchors is annotated as a probable handoff, judged against its
  own anchored history.

## 9. The Daily Wardroom [v1 candidate]

One day-derived seed, everyone plays the same cards against the same
level; the board ranks result + leak. The Daily Tide's proven ritual
pointed at poker — and it sidesteps cherry-picking entirely (one attempt,
same deck for all). Likely the best first shippable slice.

## 10. Phases

1. **Ledger v1**: chain + transcripts + publish button + static board +
   verifier; leak metric with exact-river EV weighting. Human-vs-bot only.
2. **Daily Wardroom** event on the same rails.
3. **Anchor governance, leak-profile analytics** (per-street leak — the
   chart room grown up).
4. **Human-vs-human** rated play, when the deck-secrecy protocol exists;
   same pool, bots remain the anchors.

## 11. Open questions

- Transcript event kind + relay set for nostr publishing.
- Forfeit scoring for chain gaps (flat penalty vs rated loss to the level).
- Whether the anomaly threshold should tighten as measured-human data
  accumulates (it should; governance of that is v2).
- Cross-device chain handoff UX.
