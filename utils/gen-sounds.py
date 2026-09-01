#!/usr/bin/env python3
#
# Candidate synthesized sounds — the design tool behind the absorb/create and transfer/hyperspace
# cues that have no usable sample in the Augmentinel set. See PLAN-SOUND.md.
#
#   python3 utils/gen-sounds.py [outdir]     # default: sounds/candidates/
#
# WHY SYNTHESIZED AND NOT SAMPLED. These four are PAIRS — absorb/create must be each other's
# inverse, and transfer/hyperspace two readings of one gesture. A sample bank can give you a good
# whoosh; it cannot give you a matched inverse pair, and faking one by reversing a sample inherits
# its envelope backwards (a reversed decay is a swell with a hard cut, which is why reversed
# samples always sound reversed). Generated, the pairing is a sign flip on one line.
#
# They also have to hit game timings exactly (TRANSFER_DELAY_MS = 1000, the ~500 ms morph halves),
# be mono because they are positional, and — for absorb/create, the most-heard sounds in the game —
# be short and non-fatiguing. All four are easier to dial in than to search for.
#
# THE SHAPE OF EACH. Noise through a resonant band-pass whose centre frequency is swept: that is
# what reads as "air moving" rather than "a tone". Deflate sweeps down, inflate sweeps up, and the
# gust sweeps up-then-down as it passes. A Chamberlin state-variable filter is used because it
# modulates cleanly per sample; a biquad recomputed per sample zippers.
#
# Pink noise, not white — white is harsh at these bandwidths and fatiguing on a sound the player
# hears hundreds of times a landscape. Every envelope starts and ends at zero with a >=5 ms ramp,
# or the buffer edge clicks.

import sys, os, numpy as np, wave

SR = 44100

def pink(n, rng):
	"""Paul Kellet's economical pink filter — white is too harsh for a constantly-repeated cue."""
	w = rng.standard_normal(n)
	b = np.zeros((7, n))
	# vectorising this would need a recurrence; n is small, so take the loop
	b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0
	out = np.empty(n)
	for i in range(n):
		x = w[i]
		b0 = 0.99886 * b0 + x * 0.0555179
		b1 = 0.99332 * b1 + x * 0.0750759
		b2 = 0.96900 * b2 + x * 0.1538520
		b3 = 0.86650 * b3 + x * 0.3104856
		b4 = 0.55000 * b4 + x * 0.5329522
		b5 = -0.7616 * b5 - x * 0.0168980
		out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362
		b6 = x * 0.115926
	return out / (np.abs(out).max() + 1e-9)

def svf(x, fc, q):
	"""Chamberlin state-variable band-pass. fc is an array (the sweep), q the damping (1/Q)."""
	f = 2.0 * np.sin(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
	low = band = 0.0
	out = np.empty(len(x))
	for i in range(len(x)):
		high = x[i] - low - q * band
		band += f[i] * high
		low += f[i] * band
		out[i] = band
	return out

def ramp(n, a, b, curve='exp'):
	t = np.linspace(0, 1, n)
	return a * (b / a) ** t if curve == 'exp' else a + (b - a) * t

def env(n, attack, decay, shape='decay'):
	"""Envelope with click-free edges. 'decay' = hit then fall, 'swell' = grow then stop."""
	t = np.linspace(0, 1, n)
	e = (1 - t) ** decay if shape == 'decay' else t ** attack
	e *= np.clip(t / 0.006, 0, 1) * np.clip((1 - t) / 0.010, 0, 1)   # >=5 ms both edges
	return e

def write(path, x, peak=0.7):
	x = x / (np.abs(x).max() + 1e-9) * peak
	if x.ndim == 1:
		data = (x * 32767).astype('<i2')
		ch = 1
	else:
		data = (x.T.reshape(-1) * 32767).astype('<i2')
		ch = 2
	with wave.open(path, 'w') as w:
		w.setnchannels(ch); w.setsampwidth(2); w.setframerate(SR)
		w.writeframes(data.tobytes())
	return path

# ---------------------------------------------------------------- the sounds

def sweep(dur, f0, f1, q, shape, rng, tone=0.0, tone_f=(0, 0)):
	"""The absorb/create primitive: swept band-pass over pink noise, optional tonal body."""
	n = int(SR * dur)
	x = svf(pink(n, rng), ramp(n, f0, f1), q)
	if tone > 0:
		ph = 2 * np.pi * np.cumsum(ramp(n, *tone_f)) / SR
		x = x * (1 - tone) + np.sin(ph) * tone
	return x * env(n, 0.5, 2.2, shape)

def gust(dur, lo, hi, q, rng, sweep_up=0.45, stereo=False):
	"""The whoosh primitive: the band opens as the gust arrives and closes as it leaves."""
	n = int(SR * dur)
	k = int(n * sweep_up)
	fc = np.concatenate([ramp(k, lo, hi), ramp(n - k, hi, lo * 0.7)])
	src = pink(n, rng)
	x = svf(src, fc, q)
	t = np.linspace(0, 1, n)
	x *= np.sin(np.pi * t) ** 1.3                      # arrive and leave
	x *= np.clip(t / 0.006, 0, 1) * np.clip((1 - t) / 0.010, 0, 1)
	if stereo:                                          # gust crosses left -> right
		p = np.clip(t, 0, 1)
		return np.vstack([x * np.cos(p * np.pi / 2), x * np.sin(p * np.pi / 2)])
	return x

def beep(dur, f, harm=0.0, decay=4.0):
	"""
	The error cue: a short, low, steady tone.

	IT MUST NOT READ AS PUNISHMENT, which rules out most of what "error sound" usually means.
	No pitch descent — a falling tone is the sad-trombone trope and editorialises about the
	player. No dissonance, no beating pair, no harsh harmonics. What is left is a single low
	tone with a soft attack and a quick decay, which is heard as a neutral "nothing there" tick
	rather than a scolding: the same register as a lift button that will not light.

	Low, because low frequencies carry less urgency than high ones at equal loudness. Short,
	because it fires on a keypress and anything with a tail would stack under fast play.
	"""
	n = int(SR * dur)
	t = np.linspace(0, 1, n)
	ph = 2 * np.pi * f * np.arange(n) / SR
	x = np.sin(ph) + (harm * np.sin(2 * ph) if harm else 0.0)
	e = np.exp(-decay * t)
	# 4 ms attack, and a tail fade over the last 20 ms: the exponential alone still ends at a
	# non-zero value (e^-4 is 0.018, plainly audible as a click at the buffer edge).
	e *= np.clip(t / (0.004 / dur), 0, 1)
	e *= np.clip((1 - t) / (0.020 / dur), 0, 1)
	return x * e

out = sys.argv[1] if len(sys.argv) > 1 else 'sounds/candidates'
os.makedirs(out, exist_ok=True)
R = lambda s: np.random.default_rng(s)
made = []

# absorb = deflate: band falls, energy decays.  create = inflate: the exact mirror.
for tag, (f0, f1, shape) in {'absorb': (4200, 220, 'decay'), 'create': (220, 4200, 'swell')}.items():
	made += [
		write(f'{out}/{tag}-1-air.wav',   sweep(0.55, f0, f1, 0.55, shape, R(1))),
		write(f'{out}/{tag}-2-body.wav',  sweep(0.55, f0, f1, 0.35, shape, R(1),
		                                        tone=0.30, tone_f=(f0/5, f1/5))),
		write(f'{out}/{tag}-3-snap.wav',  sweep(0.34, f0*1.5, f1, 0.70, shape, R(2))),
	]

# transfer = a short gust: only the spirit travels, and it travels fast.
made += [
	write(f'{out}/transfer-1-gust.wav',    gust(0.85, 320, 3400, 0.75, R(3))),
	write(f'{out}/transfer-2-soft.wav',    gust(1.00, 260, 2200, 1.00, R(4))),
	write(f'{out}/transfer-3-stereo.wav',  gust(0.85, 320, 3400, 0.75, R(3), stereo=True)),
]

# hyperspace = the same gesture, bigger — and the two readings must be unmistakable, because
# the whole reason hyperspace keeps a cue when transfer loses one is that a FORCED jump is the
# one the player did not choose. So this does NOT reuse gust(): that primitive always opens then
# closes (a thing passing by), which fights a one-way gesture and, fed inverted arguments, quietly
# produced a rising "forced" sound. Directionality here is the message, so it is explicit.
def warp(dur, f0, f1, tf0, tf1, q, shape, rng, tone=0.38):
	"""One-way swept whoosh plus a tonal core going the same way. Rising = go; falling = dragged."""
	n = int(SR * dur)
	x = svf(pink(n, rng), ramp(n, f0, f1), q)
	ph = 2 * np.pi * np.cumsum(ramp(n, tf0, tf1)) / SR
	x = x * (1 - tone) + np.sin(ph) * tone
	return x * env(n, 1.4, 1.8, shape)

made += [
	# voluntary: everything rises and keeps rising — you left under your own power
	write(f'{out}/hyperspace-1-voluntary.wav', warp(1.0, 260, 5600, 110, 520, 0.55, 'swell', R(5))),
	# forced: everything falls, fast attack, more resonant — you were taken
	write(f'{out}/hyperspace-2-forced.wav',    warp(1.0, 5200, 190, 560, 70, 0.32, 'decay', R(6))),
]

# error: an acknowledgement that an action was initiated and can produce no result.
made += [
	write(f'{out}/error-1-soft.wav', beep(0.11, 165)),            # round, pure, neutral
	write(f'{out}/error-2-tock.wav', beep(0.07, 140, harm=0.30, decay=7.0)),  # woodier, drier
	write(f'{out}/error-3-low.wav', beep(0.14, 110, decay=3.2)),  # lower and softer still
]

for p in made:
	print(f'  {p}')
