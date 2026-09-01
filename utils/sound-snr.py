#!/usr/bin/env python3
#
# "How much did the encode damage this sound?" — the referee behind utils/convert-sounds.sh.
#
#   python3 utils/sound-snr.py sounds/complete.wav public/sounds/complete.m4a
#
# Prints gain-matched SNR in dB, one figure per channel, source vs encoded.
#
# WHY SNR AND NOT A SPECTRAL DIFF. Added-energy-per-band was tried first and is useless here:
# every variant measured within +/-0.7 dB per band, including ones that plainly sounded worse,
# because these are short sounds whose artefacts are temporal rather than a shift in average
# band energy. SNR ranks them correctly and agrees with listening.
#
# WHY THE ABSOLUTE NUMBER IS LOW EVERYWHERE. The sources are MS ADPCM rips carrying a lot of
# random quantisation hash. No transform codec reproduces noise, and discarding it is both
# correct and inaudible, but it counts as error — so ~17 dB here is clean, not marginal. The
# number is only meaningful COMPARATIVELY, against other encodes of the same file.
#
# THE CALIBRATION, measured 2026-09-01 by ear against ten files: every sound judged good sat
# at 14.8 dB or above, every sound judged noisy at 12.7 or below. Hence the >=15 dB floor
# convert-sounds.sh encodes to. One outlier, meanie at 9.9 dB, was judged good anyway - it is
# a 0.29 s noise blip whose error is self-masking, so a short percussive sound can pass lower.
#
# Alignment is by FFT cross-correlation over the first 4096 samples (AAC has encoder delay),
# then a least-squares gain match, so neither a delay nor a level change is scored as noise.

import subprocess, sys, numpy as np
SR = 44100
def dec(p, ch):
    r = subprocess.run(['ffmpeg','-v','error','-i',p,'-af',f'pan=mono|c0=c{ch}',
                        '-f','f32le','-ar',str(SR),'-'], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)
def snr(ref, test):
    n = min(len(ref), len(test))
    m = 1 << (int(np.ceil(np.log2(n))) + 1)
    cc = np.fft.irfft(np.fft.rfft(test[:n], m) * np.conj(np.fft.rfft(ref[:n], m)), m)
    off = int(np.argmax(cc[:4096]))
    a = ref[:n-4096]; b = test[off:off+n-4096]
    k = min(len(a), len(b)); a, b = a[:k], b[:k]
    g = (a @ b) / (b @ b) if (b @ b) > 0 else 1.0
    e = a - g*b
    return 10*np.log10((a @ a)/(e @ e)) if (e @ e) > 0 else 99.0
src, enc = sys.argv[1], sys.argv[2]
chs = int(subprocess.run(['ffprobe','-v','error','-show_entries','stream=channels','-of',
                          'default=nw=1:nk=1',src], capture_output=True, text=True).stdout.strip())
print(' '.join(f'{snr(dec(src,c), dec(enc,c)):5.1f}' for c in range(chs)))
