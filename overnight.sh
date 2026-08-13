#!/bin/bash
# overnight CFR+ run: 30 chunks of 10M, checkpointed each chunk, then
# graft the solved preflop, audit vs Cepheus, and run the eval rig.
cd "$(dirname "$0")"
CEP=/tmp/claude-1000/-home-melvin-remote-github-com-melvincarvalho-tideholm/7b4ad10d-78ac-425d-9f8e-dfade84a4471/scratchpad/cepheus
echo "=== overnight CFR+ start $(date)"
rm -f train-state.json
for i in $(seq 1 30); do
  echo "--- chunk $i/30 $(date +%H:%M)"
  node train-holdem.js 10000000 || exit 1
done
echo "=== training done $(date); grafting solved preflop"
node graft-cepheus.js "$CEP"
echo "=== audit vs Cepheus"
node cepheus-compare.js "$CEP" | tail -3
echo "=== eval"
node eval.js 20000 200
echo "=== overnight complete $(date)"
