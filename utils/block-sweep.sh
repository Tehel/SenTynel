#!/usr/bin/env bash
#
# Play a block of landscapes with the demo bot, in parallel, and print one aggregated summary.
#
# The harness sweep is one vitest process playing landscapes one after another, which is fine for the
# 102-landscape smoke test and far too slow for the 1000-landscape blocks that are the honest measure
# (PLAN-BOT2.md's Method: the 102 set has been the target of every change in that document and reads
# about three points optimistic). Landscapes are completely independent — each run builds its own
# scene and its own planner — so they shard perfectly.
#
#   BLOCK=6000-6999 PLANNER=v2 ./utils/block-sweep.sh out/b4-pre
#   BLOCK=3000-3249 PLANNER=v1,v2 CHUNKS=8 FRAME_MS=15 ./utils/block-sweep.sh out/frame15
#
# Writes one log per chunk into the output directory and leaves them there: a chunk log is the raw
# per-landscape record, and utils/sweep-aggregate.js can be re-run over it without replaying anything.
#
# PAIR PRE AND POST RUNS EXACTLY. Same block, same CHUNKS, same FRAME_MS. A full run disagrees with
# itself on about one landscape's ancillary counters (see PLAN-BOT2.md's B2 verification), and the
# 1 Hz action cadence aligns differently against the 4 Hz drain phase at different frame times, so a
# comparison across different chunkings or frame times is measuring the harness, not the planner.
set -u -o pipefail

OUT=${1:?usage: BLOCK=<first>-<last> $0 <output-dir>}
BLOCK=${BLOCK:?set BLOCK, e.g. BLOCK=6000-6999}
PLANNER=${PLANNER:-v2}
FRAME_MS=${FRAME_MS:-16}
# One process per core bar a few, which is where this stops scaling: each chunk is a whole vitest +
# Node + Three.js scene at a few hundred MB, and the work is pure CPU raycasting.
CHUNKS=${CHUNKS:-12}

FIRST=${BLOCK%-*}
LAST=${BLOCK#*-}
if [ "$FIRST" = "$LAST" ] || [ -z "$LAST" ]; then echo "BLOCK must be first-last, e.g. 6000-6999" >&2; exit 1; fi
TOTAL=$((LAST - FIRST + 1))
if [ "$TOTAL" -lt "$CHUNKS" ]; then CHUNKS=$TOTAL; fi

mkdir -p "$OUT"
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE" || exit 1

echo "block $BLOCK ($TOTAL landscapes) | planner $PLANNER | frame ${FRAME_MS}ms | $CHUNKS chunks -> $OUT"

# Contiguous, deterministic boundaries: chunk i gets landscapes [FIRST + i*size, ...), remainder
# spread over the first few chunks so the split is reproducible from BLOCK and CHUNKS alone.
SIZE=$((TOTAL / CHUNKS))
REM=$((TOTAL % CHUNKS))
START=$FIRST
PIDS=""
for i in $(seq 0 $((CHUNKS - 1))); do
	n=$SIZE
	if [ "$i" -lt "$REM" ]; then n=$((n + 1)); fi
	end=$((START + n - 1))
	log="$OUT/chunk-$(printf '%02d' "$i").log"
	echo "  chunk $i: $START-$end"
	BOT_SWEEP=1 BOT_PLANNER="$PLANNER" BOT_FRAME_MS="$FRAME_MS" BOT_LEVELS="$START-$end" \
		npx vitest run src/engine/bot.harness --reporter=verbose -t sweep >"$log" 2>&1 &
	PIDS="$PIDS $!"
	START=$((end + 1))
done

# Wait for every chunk, but do not let one failure discard the rest — a chunk that dies still leaves
# a log with the landscapes it did finish, and the aggregator reports the shortfall.
FAILED=0
for pid in $PIDS; do
	wait "$pid" || FAILED=$((FAILED + 1))
done
if [ "$FAILED" -gt 0 ]; then echo "WARNING: $FAILED of $CHUNKS chunks exited non-zero — see the logs" >&2; fi

node utils/sweep-aggregate.js --expect "$TOTAL" --label "$PLANNER" "$OUT"/chunk-*.log | tee "$OUT/summary.txt"
