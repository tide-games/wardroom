#!/bin/bash
# gauntlet-eq.sh — waits for the overnight trainer, then runs the promotion
# rigs on the finished EHS2 table (with Cepheus preflop grafted onto a copy,
# so the head-to-head is graft-vs-graft, not graft-vs-homebrew).
cd "$(dirname "$0")"
CEPHEUS=/tmp/claude-1000/-home-melvin-remote-github-com-melvincarvalho-tideholm/7b4ad10d-78ac-425d-9f8e-dfade84a4471/scratchpad/cepheus
echo "=== gauntlet: waiting for trainer to finish $(date +%H:%M)"
while pgrep -f "train-holdem.js" >/dev/null; do sleep 60; done
echo "=== trainer done $(date +%H:%M); final table:"
node -e "const t=JSON.parse(require('fs').readFileSync('strategy-eq.json','utf8'));console.log(t.iterations.toLocaleString(),'iters,',t.infosets.toLocaleString(),'infosets')"
cp strategy-eq.json strategy-eq-grafted.json
node graft-cepheus.js "$CEPHEUS" strategy-eq-grafted.json || exit 1
echo "--- rig 1: head-to-head vs champion, 40k hands (raw table)"
node ab-tables.js strategy-eq.json strategy-hulimit.json 40000
echo "--- rig 2: head-to-head vs champion, 40k hands (grafted)"
node ab-tables.js strategy-eq-grafted.json strategy-hulimit.json 40000
echo "--- rig 3: LBR lower-bound exploitability, river solver armed (grafted)"
node lbr.js 2000 river strategy-eq-grafted.json
echo "--- rig 4: vs the characters (grafted)"
node eval.js 10000 150 strategy-eq-grafted.json
echo "=== gauntlet complete $(date +%H:%M)"
