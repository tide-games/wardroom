#!/bin/bash
cd "$(dirname "$0")"
echo "=== overnight EHS2 training start $(date)"
for i in $(seq 1 24); do
  echo "--- chunk $i/24 $(date +%H:%M)"
  node train-holdem.js 4000000 eq || exit 1
done
echo "=== done $(date)"
node -e "
const fs=require('fs');
const t=JSON.parse(fs.readFileSync('strategy-eq.json','utf8'));
console.log('final:', t.iterations.toLocaleString(), 'iterations,', t.infosets.toLocaleString(), 'infosets');
"
echo "=== overnight-eq complete $(date)"
