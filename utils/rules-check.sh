#!/usr/bin/env bash
#
# "Did the eye candy change the game?" — one command.
#
# Plays a fixed 100-landscape block with the demo bot through the REAL scene and REAL raycasts
# (src/engine/bot.harness.test.ts) and diffs the per-landscape records against a committed
# baseline. Cosmetic work must leave this untouched.
#
#   ./utils/rules-check.sh           # check against utils/rules-baseline.txt
#   ./utils/rules-check.sh --save    # (re)record the baseline — only on purpose
#
# WHY 100 AND NOT 1000. utils/block-sweep.sh warns that a full 1000-landscape run disagrees
# with itself on about one landscape's ancillary counters. This block does not: measured
# 2026-08-27, three consecutive runs on unchanged eye-candy produced byte-identical records
# for all 100 landscapes — transfers, failures, retries and max jump included. The noise floor
# here is zero, so a single differing line is signal, not variance. It also runs in ~17s on 16
# cores, which is what makes it usable as a routine check rather than an occasional ceremony.
#
# The knobs are pinned deliberately. BOT_FRAME_MS and the chunk count both change how the 1 Hz
# action cadence aligns against the 4 Hz drain phase, so a comparison at different values is
# measuring the harness rather than the change (see utils/block-sweep.sh's header).
set -u -o pipefail

BLOCK_RANGE=6000-6099
CHUNKS_N=10
FRAME=16
PLANNER_ID=v2

HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE" || exit 1
BASELINE=utils/rules-baseline.txt
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BLOCK=$BLOCK_RANGE PLANNER=$PLANNER_ID CHUNKS=$CHUNKS_N FRAME_MS=$FRAME \
	./utils/block-sweep.sh "$WORK/run" >"$WORK/sweep.log" 2>&1
status=$?
cat "$WORK"/run/chunk-*.log 2>/dev/null | grep -oE "^sweep [0-9]+: .*" | sort >"$WORK/records.txt"

COUNT=$(wc -l <"$WORK/records.txt")
if [ "$COUNT" -ne 100 ]; then
	echo "FAIL: expected 100 landscape records, got $COUNT (sweep exit $status)" >&2
	tail -30 "$WORK/sweep.log" >&2
	exit 2
fi

if [ "${1:-}" = "--save" ]; then
	cp "$WORK/records.txt" "$BASELINE"
	grep -A3 "sweep summary" "$WORK/run/summary.txt"
	echo "baseline recorded: $BASELINE ($COUNT landscapes)"
	exit 0
fi

if [ ! -f "$BASELINE" ]; then
	echo "no baseline at $BASELINE — run '$0 --save' first" >&2
	exit 2
fi

if diff -u "$BASELINE" "$WORK/records.txt" >"$WORK/diff.txt"; then
	echo "RULES UNCHANGED — all $COUNT landscapes identical to baseline"
	grep -A3 "sweep summary" "$WORK/run/summary.txt"
	exit 0
fi

CHANGED=$(grep -cE "^\+sweep" "$WORK/diff.txt")
echo "RULES MOVED — $CHANGED of $COUNT landscapes differ from baseline"
cat "$WORK/diff.txt"
grep -A3 "sweep summary" "$WORK/run/summary.txt"
exit 1
