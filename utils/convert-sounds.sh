#!/usr/bin/env bash
#
# The shipping sound assets: public/sounds/*.m4a, built from two sources.
#
# THE MANIFEST BELOW IS THE LIST OF WHAT SHIPS, and it is deliberately explicit rather than "encode
# everything in sounds/". Six of the Augmentinel Amiga rips are used; four are not and must not ship:
# `dissolve` was identified as the real absorb+create sound and then rejected on taste (cheap 70s
# sci-fi, and it is the most-heard sound in the game), `disintegrate` has no known role at all, and
# the Amiga `transfer`/`hyperspace` are five-note motifs over 3.5 s that cannot fit a one-second
# action. All four stay in sounds/ as source material; none of them reaches the browser.
#
# `error` has no source at all: Augmentinel has an error bip and it is not in the wav archive, so
# it is synthesized from the brief rather than ripped. Swap which candidate ships by editing the
# manifest line — error-1-soft is rounder and longer, error-3-low lower and softer.
#
# The five they are replaced by are SYNTHESIZED — see utils/gen-sounds.py and PLAN-SOUND.md. They
# are pairs (absorb/create are inverses, hyperspace has a voluntary and a forced reading), which is
# exactly what a sample bank cannot supply, so they are generated rather than sourced.
#
# A MISSING SOURCE IS A WARNING, NOT AN ERROR, and the existing .m4a is left untouched. The Amiga
# rips are ~12 MB of untracked material that is NOT in the repo and will simply be absent on most
# checkouts, so hard-failing on them would make the script unrunnable for the synthesized half —
# which IS reproducible, since utils/gen-sounds.py regenerates its inputs from nothing. The
# synthesized candidates are therefore rebuilt on demand; the ripped ones are only re-encoded when
# someone has the rips to hand.
#
#   ./utils/convert-sounds.sh
#
# THE BITRATES ARE NOT ROUND NUMBERS, THEY ARE A MEASURED FLOOR. Each is the lowest setting
# that keeps utils/sound-snr.py at or above ~15 dB for that file — the threshold calibrated by
# ear on 2026-09-01, where every sound judged clean measured >=14.8 dB and every sound judged
# noisy measured <=12.7. So `complete` gets 192k and `music` gets 128k not because one matters
# more, but because `complete` is harder content: at a common rate one of them is wrong. Change
# a rate and re-run the referee, don't change it on taste alone.
#
# -aac_coder twoloop IS NOT OPTIONAL. ffmpeg's native AAC defaults to `fast`, its cheapest
# search, and the first version of this script silently took it. twoloop is worth +1.3 to
# +3.3 dB SNR at IDENTICAL file size across every file measured — free quality, and the whole
# reason the first pass sounded noisy on the stereo files.
#
# WHAT WAS TRIED AND DOES NOTHING, so nobody re-tries it:
#   -aac_is 0   (intensity stereo off) — byte-for-byte identical SNR. Plausible theory, since
#               these are decorrelated channels and intensity stereo is exactly wrong for
#               those, but the encoder evidently was not using it here. Dead end.
#   -aac_pns 0  (noise substitution off) — now applied PER SOUND, see TONAL below. The note that
#               used to sit here saying it made no difference was true only of the material it had
#               been measured on. PNS replaces noise-like bands with synthesized noise, which is
#               free-to-helpful on noise and DESTRUCTIVE on a pure tone: the error bip measured
#               13.3 dB SNR with it on and 34.6 dB with it off. Turning it off globally was tried
#               and rejected — it repaired the tone and pushed the five noise-based sounds' band
#               envelope error from ~0.26 dB to ~0.8 dB, because there PNS is doing its actual job.
#               The giveaway on the tone was that SNR was FLAT from 56k to 128k and only jumped at
#               192k: a cliff, not a bitrate curve, which is a feature switching off rather than
#               bits running short. A "tried, does nothing" result is only as good as the sound it
#               was tried on.
#   pre-gain    Raising `complete` to -1 dBFS before encoding to reclaim its 16.8 dB of unused
#               headroom made SNR WORSE (13.1 -> 12.3 dB). AAC's allocation is perceptual and
#               already level-adaptive; there is no headroom to reclaim. Bitrate is the lever.
#   -aac_coder anmr — needs -strict -2 (experimental) and is very slow. Not worth it over
#               twoloop for a ten-file one-shot.
#
# WHY AAC/m4a AND NOT OGG. Vorbis and Opus both beat AAC on bytes, and both only reached
# Safari recently. The game auto-starts its demo on touch devices, so iOS is a first-class
# target and the codec has to be one that is simply always there. That leaves MP3 and AAC,
# and AAC is the better of the two at every bitrate measured (music: 1.4M vs 1.8M). LC-AAC
# deliberately — HE-AAC would buy more here but ffmpeg's native encoder cannot produce it.
#
# WHY THE CHANNEL COUNT IS COPIED, NEVER FORCED. Measured, the split is exact: every mono
# source is a POSITIONAL sound (turn, meanie, disintegrate, dissolve, seen) and every stereo
# source is a GLOBAL event (complete, gameover, hyperspace, transfer, music). The sources
# already are what the engine needs — a positional one-shot must be mono or a THREE.Positional-
# Audio PannerNode has nothing to pan — so -ac could only ever damage that.
#
# WHY STEREO COSTS SO MUCH MORE PER CHANNEL. These are Paula-chip rips: four voices, two
# hard-panned left, two right. The side (L-R) signal measures as loud as the mid (L+R) on
# every stereo file, i.e. the channels are near-uncorrelated, which is the one case joint
# stereo cannot exploit. Two channels here really do cost two channels.
#
# WHY 44100 IS FORCED. The sources carry preserved Amiga playback rates — 43921, 44095,
# 44099, 44105 — which are not valid AAC rates. Resampling to 44100 is a <=0.011% pitch
# shift, inaudible, and avoids relying on encoder tolerance for arbitrary rates.
#
# NOTHING NEEDS A LOWPASS. Every source sits 23-35 dB down above 11 kHz; there is no content
# up there, only ADPCM hash, and the encoder discards it for free.
#
# THE SOURCE HEADERS LIE. Every adpcm_ms file overstates its duration by exactly 35/32
# (1.09375) while every pcm_s16le file is exact — a systematic block-accounting bug in
# whatever wrote them. So `music` is 227.18s and not the 248.48s ffprobe reports, and its
# real content ends at 225.2s with the rest silence. Nothing is trimmed (silence is nearly
# free in AAC) and the .m4a files carry correct durations, but anything that LOOPS the music
# must set an explicit loop end rather than trusting the file to end when the music does.

set -euo pipefail

cd "$(dirname "$0")/.."

SRC=sounds
GEN=sounds/candidates
DST=public/sounds

# shipped name : source file.  Anything not listed here does not reach the browser.
MANIFEST="
music:$SRC/music.wav
complete:$SRC/complete.wav
gameover:$SRC/gameover.wav
seen:$SRC/seen.wav
turn:$SRC/turn.wav
meanie:$SRC/meanie.wav
absorb:$GEN/absorb-1-air.wav
create:$GEN/create-1-air.wav
transfer:$GEN/transfer-2-soft.wav
hyperspace:$GEN/hyperspace-1-voluntary.wav
hyperspace-forced:$GEN/hyperspace-2-forced.wav
error:$GEN/error-2-tock.wav
"

CODER=twoloop

# Sounds that are a TONE rather than noise, and so must not be fed to perceptual noise
# substitution. Only the error bip qualifies: everything else in the set is either sampled
# material or synthesized band-passed noise.
TONAL="error"

MUSIC_KBPS=128          # SNR 17.1 dB. 96k measured 13.8 — audibly noisy, was the first attempt
SFX_STEREO_KBPS=192     # complete needs it: 15.8 dB here, 14.4 at 160k, 13.1 at 128k
SFX_MONO_KBPS=56        # 15.6-17.5 dB across the five mono files; already ample

MUSIC_CONTENT_END=225.2 # seconds; the rest of music.m4a is trailing silence

command -v ffmpeg >/dev/null || { echo "convert-sounds: ffmpeg not found" >&2; exit 1; }
[ -d "$SRC" ] || { echo "convert-sounds: no $SRC/ directory" >&2; exit 1; }

mkdir -p "$DST"

printf '%-18s %-8s %9s %9s %7s\n' SOUND LAYOUT SRC M4A RATE
printf '%-18s %-8s %9s %9s %7s\n' ------------------ -------- --------- --------- -------

total_src=0
total_dst=0
skipped=0

for entry in $MANIFEST; do
	name=${entry%%:*}
	f=${entry#*:}
	if [ ! -f "$f" ]; then
		printf '%-18s %-8s %9s %9s %7s\n' "$name" '-' 'no src' \
			"$([ -f "$DST/$name.m4a" ] && echo kept || echo MISSING)" '-'
		skipped=$((skipped + 1))
		continue
	fi
	ch=$(ffprobe -v error -show_entries stream=channels -of default=nw=1:nk=1 "$f")

	# PNS off for tonal content only — see the -aac_pns note in the header. It is the right tool
	# for noise and the wrong one for a pure tone, so this follows the sound rather than the file.
	case " $TONAL " in *" $name "*) pns="-aac_pns 0" ;; *) pns="" ;; esac

	if [ "$name" = music ]; then
		kbps=$MUSIC_KBPS
	elif [ "$ch" = 2 ]; then
		kbps=$SFX_STEREO_KBPS
	else
		kbps=$SFX_MONO_KBPS
	fi

	# -movflags +faststart puts the moov atom first, so music.m4a can stream from an
	# <audio> element instead of having to download whole before it plays.
	ffmpeg -v error -y -i "$f" \
		-ac "$ch" -ar 44100 \
		-c:a aac -profile:a aac_low -aac_coder "$CODER" $pns -b:a "${kbps}k" \
		-movflags +faststart \
		"$DST/$name.m4a"

	src_b=$(stat -c %s "$f")
	dst_b=$(stat -c %s "$DST/$name.m4a")
	total_src=$((total_src + src_b))
	total_dst=$((total_dst + dst_b))

	[ "$ch" = 2 ] && layout=stereo || layout=mono
	printf '%-18s %-8s %9s %9s %6sk\n' "$name" "$layout" \
		"$(numfmt --to=iec <<<"$src_b")" "$(numfmt --to=iec <<<"$dst_b")" "$kbps"
done

printf '%-18s %-8s %9s %9s\n' ------------------ -------- --------- ---------
printf '%-18s %-8s %9s %9s  (%d%% of source)\n' TOTAL '' \
	"$(numfmt --to=iec <<<"$total_src")" "$(numfmt --to=iec <<<"$total_dst")" \
	$((total_dst * 100 / total_src))

if [ "$skipped" -gt 0 ]; then
	echo
	echo "$skipped source(s) absent — existing .m4a left as-is. The Amiga rips are untracked and"
	echo "not in the repo; run utils/gen-sounds.py to rebuild the synthesized ones from nothing."
fi

echo
echo "Check any file with:  python3 utils/sound-snr.py SRC.wav $DST/NAME.m4a"
