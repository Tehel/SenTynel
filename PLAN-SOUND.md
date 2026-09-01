# SenTynel — sound

Audio, from the Augmentinel sample rips to a plan for playing them. Replaces `PLAN.md`'s
Phase 7 **Audio** bullet, which was one line and is now cross-referenced here rather than
duplicated.

**Status (2026-09-01): assets converted and accepted, nothing implemented.** `public/sounds/`
holds ten shipping `.m4a` files, `utils/convert-sounds.sh` regenerates them and
`utils/sound-snr.py` referees the result. No code plays anything yet; `settings.soundVolume`
has existed in the menu for months and still does nothing.

## Where the sounds come from

Augmentinel — an embedded emulator running the actual Spectrum binary, already used as the
fidelity oracle in `RULES-FIDELITY.md` — ships sample sets for several machines of the era.
These are the **Amiga** set, the best of them, dropped into a top-level `sounds/` directory
that is deliberately **not** in `public/`: it is the source material, not a shipping asset.
Keep it out of the build.

Fourteen files arrived. Four were removed before conversion:

| Removed | Why |
|---|---|
| `ping`, `pong` | Byte-identical to each other (same md5) and no evident role in our game |
| `title` | Byte-identical to `hyperspace`; `music` takes the title role and is much better |
| `u-turn` | Covered the original's seconds-long blank screen during a U-turn. Our U-turn is quasi-instant, so there is nothing to cover |

Ten remain. Their roles, as identified by the landscape owner from the original game:

| Sound | Role | Positional? |
|---|---|---|
| `music` | Title screen and pause screen. **Never during gameplay** | global |
| `complete` | Landscape won | global |
| `gameover` | Landscape lost | global |
| `seen` | Under a watcher's gaze — today's orangeish border | **positional** |
| `turn` | A watcher completing a rotation step — **a watcher's, never the player's** | **positional** |
| `meanie` | A tree becoming a Meanie | **positional** |
| `dissolve` | **Both absorbing and creating**, by the player or by a watcher. Identified, then **rejected on taste** — see below | **positional** |
| `disintegrate` | **No known role.** Checked in Augmentinel 2026-09-01 and no use was found. Kept, unassigned | **positional** |
| `hyperspace` | Hyperspace — **but see below, the file is unusable** | global |
| `transfer` | Transfer — **decided against, see below** | global |

## What we measured

Five findings, all from the files themselves, all of which changed a decision.

**The positional/global split is already baked into the channel counts.** Every mono source is
a positional sound; every stereo source is a global event. Nothing had to be chosen — the
sources already are what the engine needs, which is why `convert-sounds.sh` *copies* the channel
count and never forces one. A positional one-shot must be mono or a `PannerNode` has nothing
to pan.

**The stereo is Paula-chip stereo, and it is expensive.** Four voices, two hard-panned left, two
right. Measured, the side (L−R) signal is as loud as the mid (L+R) on every stereo file: the
channels are near-uncorrelated, the one case joint stereo cannot exploit. Two channels here
genuinely cost two channels, which is why the stereo files need far more than half the per-channel
rate the mono files get.

**Every ADPCM header lies by exactly 35/32.** Ten of the fourteen sources are MS ADPCM; those
overstate their duration by a factor of 1.09375, while every `pcm_s16le` source is exact. A
systematic block-accounting bug in whatever wrote them, not per-file damage. So `music` is
227.18 s and not the 248.48 s `ffprobe` reports, and `hyperspace`/`transfer` are 3.500 s and not
3.83. **Trust the decoded length, never the header** — the `.m4a` files carry correct durations.

**`music` has 2 s of trailing silence.** Real content ends at 225.2 s of a 227.18 s file. Nothing
is trimmed (silence is nearly free in AAC), but anything that loops the music must set an
explicit loop end rather than trusting the file to end when the music does.
`convert-sounds.sh` records the number as `MUSIC_CONTENT_END`.

**Nothing has content above 11 kHz.** Every source sits 23–35 dB down up there — ADPCM hash, not
signal. No lowpass is needed, the encoder discards it for free, and it is why these bitrates are
generous rather than tight.

## What ships

`utils/convert-sounds.sh` carries an **explicit manifest** of the eleven files that reach the
browser, rather than encoding whatever is in a directory. Six are Augmentinel rips (`music`,
`complete`, `gameover`, `seen`, `turn`, `meanie`) and five are synthesized (`absorb`, `create`,
`transfer`, `hyperspace`, `hyperspace-forced`). Four rips are converted by nobody and ship
nowhere: `dissolve` (rejected on taste), `disintegrate` (no known role), and the Amiga
`transfer`/`hyperspace` (five-note motifs that cannot fit a one-second action).

**A missing source is a warning, not an error**, and the existing `.m4a` is left alone. The rips
are ~12 MB of untracked material that is *not in the repo* and will be absent on most checkouts,
so hard-failing on them would make the script unrunnable for the synthesized half — which is fully
reproducible, since `utils/gen-sounds.py` builds its own inputs from nothing. Practical
consequence: **the synthesized sounds can always be rebuilt; the ripped ones can only be re-encoded
by someone holding the rips.** The committed `.m4a`s are therefore the real artifact for those six.

## The conversion

**AAC in `.m4a`, LC profile.** Vorbis and Opus both beat it on bytes and both only reached Safari
recently. The game auto-starts its demo on touch devices, so iOS is a first-class target and the
codec has to be one that is simply always there — which leaves MP3 and AAC, and AAC wins at every
bitrate measured (`music`: 1.4M vs 1.8M). HE-AAC would buy more but ffmpeg's native encoder
cannot produce it.

**`-aac_coder twoloop` is not optional.** ffmpeg's native AAC defaults to `fast`, its cheapest
search, and the first conversion silently took it. `twoloop` is worth **+1.3 to +3.3 dB SNR at
identical file size** on every file measured. This — not the bitrate — was the whole cause of the
first pass sounding noisy, and it improved even the files that had already been accepted.

**The bitrates are a measured floor, not round numbers.** Each is the lowest setting keeping
`utils/sound-snr.py` at or above ~15 dB for that file. The threshold was calibrated by ear on
2026-09-01 across ten files: everything judged clean measured ≥14.8 dB, everything judged noisy
≤12.7. So `complete` gets 192k and `music` gets 128k not because one matters more, but because
`complete` is harder content. **Change a rate and re-run the referee**, don't change it on taste.

| | rate | SNR before | SNR after |
|---|---|---|---|
| `complete` | stereo 192k | 9.1 / 8.8 | 15.8 / 15.5 |
| `gameover` | stereo 192k | 12.6 / 12.4 | 20.2 / 20.5 |
| `hyperspace` | stereo 192k | 12.6 / 11.8 | 20.4 / 21.1 |
| `transfer` | stereo 192k | 12.7 / 12.1 | 20.6 / 21.4 |
| `music` | stereo 128k | 14.8 / 14.9 | 17.1 / 16.9 |
| `seen` | mono 56k | 17.2 | 23.7 |
| `disintegrate` | mono 56k | 16.6 | 18.0 |
| `dissolve` | mono 56k | 15.6 | 16.2 |
| `turn` | mono 56k | 17.5 | 18.3 |
| `meanie` | mono 56k | 9.9 | 12.7 |

12 MB of WAV → 4.1 MB of `.m4a`, of which `music` alone is 3.6 MB.

`meanie` is the one file below the floor and it was accepted by ear at 9.9 dB, before the coder
fix. It is a 0.29 s noise blip whose error is self-masking — **a short percussive sound can pass
lower**, which is a property of the metric, not a licence to relax it elsewhere.

**The absolute SNR figures are low everywhere and that is fine.** These are ADPCM rips carrying a
lot of random quantisation hash; no transform codec reproduces noise, and discarding it is both
correct and inaudible, but it counts as error. ~17 dB here is clean, not marginal. The number is
only meaningful *comparatively*, between encodes of the same file.

### Tried, does nothing — do not re-try

- **`-aac_is 0`** (intensity stereo off). Byte-for-byte identical SNR. A good theory — intensity
  stereo is exactly wrong for decorrelated channels — but the encoder was evidently not using it.
- **`-aac_pns 0`** (noise substitution off). Within measurement noise.
- **Pre-gain.** `complete` peaks at −16.8 dBFS, so reclaiming its headroom before encoding looked
  free. It made SNR **worse** (13.1 → 12.3 dB). AAC's allocation is perceptual and already
  level-adaptive; there is no headroom to reclaim. Bitrate is the only lever.
- **`-aac_coder anmr`.** Needs `-strict -2` and is very slow. Not worth it over `twoloop`.
- **Added-energy-per-band as the metric.** Tried before SNR and useless here: every variant
  measured within ±0.7 dB per band including ones that plainly sounded worse, because these
  artefacts are temporal rather than a shift in average band energy. SNR ranks them correctly and
  agrees with listening.

## Decisions

**No music during gameplay.** The original was near-silent — partly a hardware limit, but that
silence is also the atmosphere, and it is kept deliberately.

Where it *does* play differs by platform, and not arbitrarily:

- **Desktop: the menu screen only.** A desktop pause is a brief interruption, not a destination;
  starting a tune every time someone hits Escape would grate. **Pause stays silent.**
- **Touch: the menu screen and the pause screen.** The pause overlay *is* the touch UI — it holds
  the landscape picker, the reset button and (see below) the volume slider — so it is a place the
  player deliberately goes and sits, not a hiccup. It is also the only screen where a gesture is
  available to unlock audio at all.

`music` is kept at **full length and full quality** (225 s, 128k, 3.6 MB of the 4.1 MB payload).
Trimming it was considered and deferred: revisit only if it measurably hurts, and note the honest
lever is *length*, not bitrate — 96k measures 13.8 dB, below the floor, and is audible.

**Transfer gets a short gust of wind** — *revised 2026-09-01, reversing the "no transfer sound"
call above it.* The reasoning that killed the **sample** stands: the original's `transfer` existed
to cover a three-second blank screen, ours has a one-second glide with an explicit cross-fade, and
the 3.5 s five-note motif would only fight it. But "the sample is wrong" was allowed to become
"nothing is right", which was too quick. A gust is the correct image and a very different sound
from a melody: **only the spirit travels, and it travels fast.** Short, airy, over before the glide
is.

Transfer and hyperspace are then **two readings of one gesture**, not two unrelated cues — same
family, different weight.

**Hyperspace needs a new sound, synthesized.** It cannot be dropped the way `transfer` was: the
player has much less control over a hyperspace, especially a Meanie-forced one, so it needs an
audible cue. But the sample is a five-note motif over 3.5 s against a one-second action, and it
survives **neither** cutting nor speeding up — both were considered and rejected. A hyperspace cue
is a *gesture*, not a melody: an oscillator sweep plus a filtered noise burst is a few dozen lines
of Web Audio, costs no bytes, is tunable live in the browser, and lets **forced and voluntary
jumps differ**, which matters precisely because the forced one is the one you did not choose.

**`seen` pulses, it does not loop.** The file is a decaying one-shot — −21.8 dB at the head,
−55.4 dB at the tail — so butting end onto start gives a 33 dB jump that clicks once a second.
Rather than surgery, repeat it: a pulsing alarm is the right instrument for "you are seen", and at
0.93 s against `WATCHER_GRACE_MS` (3000) it sounds about three times before the first point is
taken. The repeat interval can tighten as the lock-on counts down, in step with
`ScanVignette`'s ramp, which is already driven by exactly that clock (`RULES-FIDELITY.md` C6).

**The demo makes the normal gameplay sounds.** It is an attract mode; a silent one is a worse
demo. No special-casing, no separate mix — it plays what a player would hear, and the touch pause
slider (full left for silence) is the way out for anyone leaving a soak running overnight.

A worry raised and **withdrawn**: that an unattended run would hammer `turn` once a second. It
would not. `turn` is a **watcher** rotation, never the player's, and watchers turn one 28.125°
step every **12 seconds** (`TURN_PERIOD_TICKS = 48` at the 4 Hz tick, `world/objects/watcher.ts`,
before the per-completion 5% speedup), phase-staggered so they do not sync. With a Sentinel and a
few Sentries that is a handful of sparse, atmospheric cues a minute. The "once a second" figure
was the **1 Hz drain phase** confused for the rotation clock — they are different clocks and only
the drain one runs at 1 Hz.

**`dissolve` is out; absorb and create get two purpose-built sounds.** It is the right sound
*functionally* — Augmentinel plays it for every object appearing or disappearing, by the player or
by a watcher — but it reads as cheap 70s sci-fi, and it is the most-heard sound in the game, so it
sets the tone of the whole soundtrack. Splitting it in two also fixes something the single sample
could not express: **appearing and disappearing are opposite events and should sound opposite.**

The image is **deflate and inflate**: a swept sound falling for absorb, rising for create. That
also happens to be the one thing a sample bank cannot supply — see *Synthesizing the four missing
sounds*.

**Positional sounds are really positional.** Three.js `PositionalAudio` wraps a Web Audio
`PannerNode` and re-reads its object's world matrix every frame, with `AudioListener` riding the
camera — and our camera *is* the player's eye, so it fits with no adaptation. All five positional
sounds are already mono.

- Start with **`panningModel = 'equalpower'`**, not the Three.js default `'HRTF'`. HRTF is built
  for headphones and can read as phasey on speakers; equalpower is literally "stereo volumes hint
  the direction", which is the effect wanted, and is cheaper.
- **Do not parent the audio to the `GameObject`**, even though that is the documented Three.js
  pattern. `disintegrate` plays *because* the object is being removed, so a parented node would be
  torn down mid-sound. `engine/particles.ts` already solved this exact shape — bursts fire from
  `addObjectToScene`/`removeObjectFromScene` and outlive their object — so audio follows it: a
  pool held in `engine/`, positioned at the cell, never in the scene graph under the thing that
  triggered it. This is the same class of mistake as the corpse rule in `GameObject.remove()` and
  `PLAN-BOT2.md`'s postscript 19: **a handle on an object is only as good as the moment it was
  taken in.**

**Audio glue lives in `engine/`, never `game/`.** `PositionalAudio` is a `three` value import, and
`game/` must not load `three` at runtime (`CLAUDE.md`, *Coding conventions*). The rules layer can
at most emit an event; nothing in `game/` may touch an audio node.

## Synthesizing the four missing sounds

Four cues have no usable sample: **absorb** and **create** (`dissolve` rejected on taste),
**transfer** (the gust) and **hyperspace** (the motif does not fit a one-second action). All four
are generated by `utils/gen-sounds.py` into `sounds/candidates/` — candidates for audition, not
shipping assets.

**Why generated rather than sourced.** These are **pairs**. Absorb and create must be each other's
inverse; transfer and hyperspace two weights of one gesture. A sample bank can give you an
excellent whoosh; it cannot give you a matched inverse pair. Faking one by reversing a sample
inherits its envelope backwards — a reversed decay is a swell with a hard cut, which is why
reversed samples always sound reversed. Generated, the pairing is a sign flip on one line. They
also have to hit game timings exactly (`TRANSFER_DELAY_MS` 1000, the ~500 ms morph halves), be
mono because they are positional, and — for absorb/create, heard hundreds of times a landscape —
be short and non-fatiguing.

**How they are built.** Pink noise (white is harsh and fatiguing on a constantly-repeated cue)
through a resonant band-pass whose centre frequency is swept: that is what reads as *air moving*
rather than *a tone*. A Chamberlin state-variable filter, because it modulates cleanly per sample
where a biquad recomputed per sample zippers. Every envelope starts and ends at true zero with a
≥5 ms ramp, or the buffer edge clicks.

**Chosen 2026-09-01** (by ear, from the candidates below): **`absorb-1-air` / `create-1-air`** —
the restrained pair, no tonal core; **`transfer-2-soft`**; and **both** hyperspace readings as
generated. They ship as `absorb`, `create`, `transfer`, `hyperspace` and `hyperspace-forced`.

**`transfer` ships mono, and the stereo candidate was rejected on a rule rather than a preference:
the transfer sound is always located on the camera.** It is our own spirit travelling, so there is
no direction for a pan to express — a moving gust would be describing a journey the listener is
*inside*. Stereo would be motion for its own sake. (This is the reverse of `turn` or `meanie`,
which happen to something out in the world and genuinely have a bearing.)

The candidates, three shapes per pair:

| | |
|---|---|
| `absorb-1-air` / `create-1-air` | Pure air, no tonal core. The most restrained |
| `absorb-2-body` / `create-2-body` | Adds a swept sine underneath — more substance, more synthetic |
| `absorb-3-snap` / `create-3-snap` | Shorter (0.34 s) and brighter. For if the others drag |
| `transfer-1-gust`, `-2-soft`, `-3-stereo` | The gust; `-3` crosses left to right as it passes |
| `hyperspace-1-voluntary` | Everything rises and keeps rising — you left under your own power |
| `hyperspace-2-forced` | Everything falls, fast attack, more resonant — you were taken |

**Hyperspace does not reuse the gust primitive**, deliberately. A gust opens then closes (a thing
passing by), which fights a one-way gesture — and fed inverted arguments it quietly produced a
*rising* "forced" sound, the exact opposite of the alarm intended. Directionality is the message
here, so it is explicit. Caught by measuring spectral centroid over time, not by listening, which
is worth remembering: **a synthesis bug can be inaudible to the person who cannot hear it and
obvious in one number.**

**If a bank is preferred after all**, the constraint is licensing — this project ships free assets
with attribution (the Poly Haven skyboxes), so **CC0** is the bar, not "royalty-free", which is a
different and weaker thing that often restricts redistribution. Worth a look:
[Kenney](https://kenney.nl/assets) (CC0, no attribution, no sign-up),
[OpenGameArt's CC0 sounds library](https://opengameart.org/content/cc0-sounds-library),
[Freesound](https://freesound.org) filtered to CC0 (per-sound licences vary — check every file),
and the [Sonniss GDC bundles](https://sonniss.com/gameaudiogdc). Avoid Mixkit and Storyblocks
for this: they market "royalty-free" whooshes, which is not CC0.

### The SNR floor does not apply to these

Encoded at the same 56k as the mono rips, the synthesized sounds measure **8.8 to 20.9 dB** —
`absorb` at 8.8 and `transfer` at 13.0 sit *below* the ≥15 dB floor that governs the rips. They
were **not** given more bitrate, because the floor is the wrong instrument here and raising the
rate would have been cargo-culting a number.

These sounds are *entirely band-passed noise*. AAC does not reproduce noise — it reproduces a
noise with the same spectrum — so the waveform differs completely while the sound is identical.
That is the same effect that keeps every rip's absolute SNR low (see the referee's header), except
here it is the whole signal rather than a hash riding on top of it.

The right measurement for noise is whether the **spectral envelope** survives, since that is what
a noise sound *is*. Measured over 12 log-spaced bands per frame:

| | envelope correlation | median band error |
|---|---|---|
| `absorb` | 0.9960 | 0.28 dB |
| `create` | 0.9947 | 0.27 dB |
| `transfer` | 0.9979 | 0.25 dB |
| `hyperspace` | 0.9939 | 0.26 dB |
| `hyperspace-forced` | 0.9943 | 0.25 dB |

Indistinguishable. **The lesson is that a calibrated threshold carries its calibration set with
it**: ≥15 dB was measured against ADPCM rips of sampled material and says nothing about
synthesized noise. Check which kind of sound you have before trusting the number.

## Volume and the two switches

**One global volume, on a logarithmic scale.** `settings.soundVolume` keeps its 0–10 range, but
linear gain is wrong for loudness — 5 would sound far louder than half. The mapping is **uniform
decibels per step**, with two anchors fixed by intent:

- **0 is true silence**, not a very small gain. It must be a genuine mute.
- **10 is deliberately much too loud.** The ceiling is unity — the loudest asset at full scale —
  so the control never has to clip to get there, and "too loud" comes from the material rather
  than from distortion. Sources peak between −2.3 and −16.8 dBFS, so anything above unity on the
  master would clip the hot ones (`turn` at −2.3 dBFS first).

That leaves the dB-per-step and therefore the useful default, which is a tuning decision and wants
a browser, not a spreadsheet. Roughly 3.5 dB a step puts 10 at unity and 1 around −31 dB, which is
quiet but audible; the current default of 5 would then sit near −17 dB and probably wants raising.
**Tune by ear, then record the number here.**

**Two independent on/off switches**, both in the settings menu, both separate from the volume:

- **Music: on/off**
- **Sound effects: on/off**

They are switches rather than a second and third slider deliberately — the volume is global, and
what people actually want is "keep the game sounds, lose the tune", which a toggle says plainly.

**Touch gets a single slider instead**, on the pause overlay, alongside the landscape picker and
the reset button. Full left is no sound. One control, because the pause overlay is a place you
visit briefly with a thumb, not a settings tree. Two gotchas, both already paid for once in this
codebase by the landscape picker (`PLAN-MOBILE.md` M0.5):

- It **must** carry `data-touch-control`, or the drag that moves the slider also reads as a tap
  and resumes the demo out from under the player.
- Pointer Events with `setPointerCapture` and `touch-action: none`, or the browser claims the
  drag as a scroll and the slider fights the page.

## Mobile & iOS

The constraint: iOS will not start an `AudioContext` without a user gesture, and **the touch demo
auto-starts without one** (`App.svelte`, guarded by `isTouchCapable()`) — by design, because a
phone landing on MENU is looking at an arrow-key tree it cannot drive. So a phone demo is silent
from the first frame and there is no gesture in sight.

The way out is the one gesture the demo already has. The **tap that pauses** and the **tap that
resumes** are both real user gestures, so:

- **Start silent on touch.** No attempt to play anything until a gesture has happened.
- **The resume tap unlocks audio**, and once unlocked, **the pause screen plays `music`** — which
  is where music belongs anyway, so the platform limit and the design agree.

One ordering trap, already hit once in this codebase: `audioCtx.resume()` must be called
**synchronously** inside the touch handler. Anything async in front of it spends the gesture and
the resume is refused — the identical constraint as `enterFullscreenLandscape()` before
`resumeDemo()`, already documented in `CLAUDE.md`. So the resume tap does
`enterFullscreenLandscape()`, then `audioCtx.resume()`, both synchronous, before anything else.

## Phases

### S1 — the audio layer
- [ ] `engine/audio.ts`: one `AudioContext` (via `THREE.AudioContext`), and the volume model below.
- [ ] `decodeAudioData` for the nine SFX, a streamed `<audio>` + `createMediaElementSource` for
  `music`. **Not `decodeAudioData` for the music**: decoded it is 227 s × 44.1 kHz × 2ch ×
  Float32 ≈ 80 MB resident, which is punishing on a phone and unrelated to its 3.6 MB download.
  The SFX are the opposite case — ~29 s total, a few MB decoded, and they want buffers for
  latency.
- [ ] Lazy-load `music` (it is 88% of the audio payload and only the menu needs it), the same way
  the QuickJS sandbox is kept out of the game's bundle.
- [ ] Teardown on scene rebuild — the `Disposer` pattern, extended to audio nodes.

### S2 — the global sounds
- [ ] `complete` on WON, `gameover` on LOST.
- [ ] `music` on the **menu screen**. Desktop pause stays silent; the touch pause plays it (S6).
- [ ] The two settings switches — **Music: on/off** and **Sound effects: on/off**.
- [ ] Confirm they do not fight the existing overlays' timing (both screens are keypress-only, no
  timer).

### S3 — the positional sounds
- [ ] `AudioListener` on the camera; a pooled `PositionalAudio` per concurrent sound, positioned
  at the cell, `equalpower`.
- [ ] Tune `refDistance`/`rolloffFactor` for a 32×32 map — the distances involved are small
  numbers, so the defaults will almost certainly be wrong.
- [ ] `turn` on watcher rotation, `meanie` on conversion, absorb on `removeObjectFromScene`.
- [ ] **Audition the absorb/create candidates** and pick a pair (or re-tune
  `utils/gen-sounds.py` until one is right — it is the design tool, not a one-shot).
- [ ] Fire them from `addObjectToScene` / `removeObjectFromScene`, whoever caused the event —
  player or watcher. The most-heard sounds in the game, so the ones to get right first.
- `dissolve` is **rejected on taste** and `disintegrate` has **no known role** (checked in
  Augmentinel 2026-09-01, no use found). Both stay converted and unused. The name similarity
  between `dissolve` and the `dissolve` animation style is a **coincidence**.

### S4 — the scan alarm
- [ ] `seen` as a repeating pulse driven by the same clock as `ScanVignette`, tightening as the
  lock-on counts down.
- [ ] Distinguish `'full'` from `'partial'` scan state (`game.scanState`) — or deliberately do
  not, and record why.

### S5 — the gust: transfer and hyperspace
- [ ] Audition the gust and hyperspace candidates; pick one family.
- [ ] Transfer's gust against the 1 s glide — it should be over before the glide is.
- [ ] Hyperspace voluntary vs forced. Confirm the two are distinguishable *in play*, not just
  side by side, since that is the only moment the distinction does any work.
- [ ] Decide **baked vs runtime**: a chosen candidate can ship as an `.m4a` like the others, or be
  ported to live Web Audio. Baked is simpler and makes them ordinary positional buffers; runtime
  is tunable and free of bytes. Bake unless a reason appears.

### S6 — mobile pass
- [ ] Gesture unlock on the resume tap, synchronous, ahead of everything else.
- [ ] Music on the pause screen once unlocked (touch only — desktop pause stays silent).
- [ ] The single volume slider on the pause overlay, full left for silence. `data-touch-control`,
  Pointer Events + `setPointerCapture`, `touch-action: none` — see *Volume and the two switches*.
- [ ] On-device verification, folded into `PLAN-MOBILE.md`'s outstanding on-device pass.

### Open, not yet decided
- **The exact dB-per-step of the volume curve, and the default.** See *Volume and the two
  switches*. Needs a browser and ears; record the number here once tuned.
- An ambient hum. `PLAN.md`'s original bullet listed one; there is no sample for it, and the
  "silence is the atmosphere" decision above argues against inventing one.
- An error sound. `PLAN.md`'s bullet listed one and no file covers it. Note a create sound is
  **no longer** open — `dissolve` covers create as well as absorb.
