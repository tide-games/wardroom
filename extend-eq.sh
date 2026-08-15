#!/bin/bash
# extend-eq.sh — the challenger returns to camp: 50 more 4M chunks
# (96M -> ~296M, parity with the champion's training budget).
cd "$(dirname "$0")"
echo "=== extend-eq start $(date)"
for i in $(seq 1 50); do
  echo "--- chunk $i/50 $(date +%H:%M)"
  node train-holdem.js 4000000 eq || exit 1
done
echo "=== extend-eq complete $(date)"
