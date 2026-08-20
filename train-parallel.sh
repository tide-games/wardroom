#!/bin/bash
# train-parallel.sh — parallel CFR in short bursts with frequent merges:
# workers stay near the regret frontier, so parallel exploration overlaps
# less and learns more per iteration.
#   ./train-parallel.sh [workers=6] [iters-per-burst=250000] [bursts=4] [state] [table]
cd "$(dirname "$0")"
export NODE_OPTIONS=--max-old-space-size=16384   # NL states are heavy; merges hold three
W=${1:-6}; K=${2:-250000}; R=${3:-4}
BASE=${4:-train-state-eq.json}
OUT=${5:-strategy-eq.json}
TRAINER=${6:-train-holdem.js}
echo "=== parallel: $W workers x $(printf "%'d" $K) x $R bursts on $BASE $(date +%H:%M)"
cp "$BASE" "$BASE.prev"                     # one-round undo, always
for r in $(seq 1 $R); do
  WLIST=""
  for i in $(seq 1 $W); do cp "$BASE" "$BASE.w$i"; WLIST="$WLIST $BASE.w$i"; done
  for i in $(seq 1 $W); do
    TRAIN_STATE="$BASE.w$i" TRAIN_OUT=/dev/null nice -n 19 node $TRAINER $K eq > "$BASE.log$i" 2>&1 &
  done
  wait
  node merge-states.js "$BASE" "$BASE.merged" $WLIST || exit 1
  mv "$BASE.merged" "$BASE"
  echo "--- burst $r/$R merged $(date +%H:%M)"
done
rm -f "$BASE".w[0-9]* "$BASE".log[0-9]*
TRAIN_STATE="$BASE" TRAIN_OUT="$OUT" nice -n 19 node $TRAINER 0 eq | tail -1
echo "=== parallel run complete $(date +%H:%M)"
