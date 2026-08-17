#!/bin/bash
# train-parallel.sh — N gentle workers, one merge. Baby-step parallel CFR:
#   ./train-parallel.sh [workers=6] [iters-per-worker=1000000]
# Reads train-state-eq.json, writes train-state-eq.json + strategy-eq.json.
cd "$(dirname "$0")"
W=${1:-6}
K=${2:-1000000}
echo "=== parallel round: $W workers x $(printf "%'d" $K) iters $(date +%H:%M)"
for i in $(seq 1 $W); do cp train-state-eq.json train-par-$i.json; done
for i in $(seq 1 $W); do
  TRAIN_STATE=train-par-$i.json TRAIN_OUT=/dev/null nice -n 19 node train-holdem.js $K eq > train-par-$i.log 2>&1 &
done
wait
node merge-states.js train-state-eq.json train-state-eq-merged.json train-par-*.json || exit 1
cp train-state-eq.json train-state-eq.prev.json     # one-round undo, always
mv train-state-eq-merged.json train-state-eq.json
TRAIN_STATE=train-state-eq.json nice -n 19 node train-holdem.js 0 eq   # re-export the table
rm -f train-par-*.json train-par-*.log
echo "=== round complete $(date +%H:%M)"
