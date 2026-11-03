import wave
import numpy as np

SR = 44100
DURATION = 192.0
N = int(SR * DURATION)

left = np.zeros(N, dtype=np.float32)
right = np.zeros(N, dtype=np.float32)
rng = np.random.default_rng(777)

def add_st(start_s, sig_l, sig_r=None):
    if sig_r is None:
        sig_r = sig_l
    i0 = int(start_s * SR)
    if i0 >= N:
        return
    if i0 < 0:
        sig_l = sig_l[-i0:]
        sig_r = sig_r[-i0:]
        i0 = 0
    L = min(len(sig_l), N - i0)
    if L <= 0:
        return
    left[i0:i0+L] += sig_l[:L]
    right[i0:i0+L] += sig_r[:L]

def make_env(length, atk_s=0.05, rel_s=0.2):
    env = np.ones(length, dtype=np.float32)
    a = min(length // 2, max(1, int(atk_s * SR)))
    r = min(length // 2, max(1, int(rel_s * SR)))
    env[:a] = np.linspace(0.0, 1.0, a, dtype=np.float32)
    env[-r:] = np.linspace(1.0, 0.0, r, dtype=np.float32)
    return env

def synth_pad_chord(start_s, dur_s, freqs, amp=0.06, bright=0.25):
    L = int(dur_s * SR)
    lt = np.arange(L, dtype=np.float32) / SR
    env = make_env(L, min(0.8, dur_s * 0.25), min(1.1, dur_s * 0.3))
    sl = np.zeros(L, dtype=np.float32)
    sr = np.zeros(L, dtype=np.float32)
    for idx, f in enumerate(freqs):
        o1 = np.sin(2 * np.pi * f * lt) + bright * np.sin(2 * np.pi * f * 2.0 * lt)
        o2 = np.sin(2 * np.pi * (f * 1.003) * lt + 0.7 * idx) + bright * 0.8 * np.sin(2 * np.pi * (f * 1.997) * lt)
        pan = 0.25 + 0.5 * (idx / max(1, len(freqs) - 1))
        sl += o1 * (1.0 - pan * 0.4) * amp
        sr += o2 * (0.6 + pan * 0.4) * amp
    add_st(start_s, sl * env, sr * env)

def add_taiko_hit(t_hit, amp=0.28):
    L = int(0.45 * SR)
    lt = np.arange(L, dtype=np.float32) / SR
    f = 44.0 + 90.0 * np.exp(-lt * 28.0)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-lt * 8.5)
    thump = rng.normal(0, 1, L).astype(np.float32)
    thump = np.convolve(thump, np.ones(18, dtype=np.float32)/18.0, mode='same') * np.exp(-lt * 36.0) * 0.35
    sig = (body + thump) * amp
    sig[:120] *= np.linspace(0, 1, 120, dtype=np.float32)
    add_st(t_hit, sig * 0.98, sig * 1.02)

def add_footsteps(t_start, t_end, step_interval=0.34, amp=0.055, wet=False):
    cur = t_start
    idx = 0
    while cur < t_end:
        L = int(0.11 * SR)
        lt = np.arange(L, dtype=np.float32) / SR
        n = rng.normal(0, 1, L).astype(np.float32)
        if wet:
            # Splashy water step
            splash = np.convolve(n, np.hanning(8)/4.0, mode='same') * np.exp(-lt * 22.0)
            sig = splash * amp * 1.35
        else:
            thud = np.sin(2 * np.pi * (110 - 50 * lt / 0.11) * lt) * np.exp(-lt * 42.0) * 0.6
            grit = np.convolve(n, np.hanning(12)/6.0, mode='same') * np.exp(-lt * 45.0) * 0.5
            sig = (thud + grit) * amp
        pan_l = 0.85 if idx % 2 == 0 else 0.55
        pan_r = 0.55 if idx % 2 == 0 else 0.85
        add_st(cur, sig * pan_l, sig * pan_r)
        cur += step_interval
        idx += 1

def add_bird_chirp(t0, base_f=2400.0, amp=0.028):
    L = int(0.16 * SR)
    lt = np.arange(L, dtype=np.float32) / SR
    f = base_f + 750.0 * np.sin(2 * np.pi * 14.0 * lt)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sig = np.sin(ph) * np.exp(-lt * 16.0) * amp
    sig[:80] *= np.linspace(0, 1, 80, dtype=np.float32)
    add_st(t0, sig * 0.7, sig * 1.0)

# =========================================================
# SCENE 1 (0 - 27s): Peaceful City -> Blackout (9.5s) -> Apartment Wake
# =========================================================
synth_pad_chord(0.0, 9.6, [261.63, 329.63, 392.00, 493.88], amp=0.055, bright=0.3)
for bt in [1.1, 1.35, 3.2, 4.8, 5.05, 7.1]:
    add_bird_chirp(bt, 2300 + (bt * 130) % 500, 0.025)

# 9.5s: MASSIVE POWER-GRID BLACKOUT DROP + EMP THUD
emp_len = int(2.6 * SR)
et = np.arange(emp_len, dtype=np.float32) / SR
emp_f = 18.0 + 135.0 * np.exp(-et * 2.4)
emp_sig = np.sin(2 * np.pi * np.cumsum(emp_f) / SR) * np.exp(-et * 1.4) * 0.42
spark_burst = rng.normal(0, 1, emp_len).astype(np.float32) * np.exp(-et * 8.0) * 0.14
add_st(9.45, emp_sig + spark_burst, emp_sig * 0.95 + spark_burst * 0.85)

# Distant Flashing Red Warning Sirens (10.5s -> 26.5s)
for s_t in np.arange(10.8, 26.0, 2.2):
    sL = int(1.5 * SR)
    st = np.arange(sL, dtype=np.float32) / SR
    sf = 520.0 + 190.0 * np.sin(2 * np.pi * 0.75 * st)
    siren = (np.sin(2 * np.pi * np.cumsum(sf) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(sf) / SR)) * make_env(sL, 0.2, 0.35) * 0.028
    add_st(s_t, siren * 0.65, siren * 1.0)

# Tense minor drone in apartment (11s -> 27s) + footsteps to window (21.5s -> 24.8s)
synth_pad_chord(11.0, 16.5, [110.0, 164.81, 220.0, 261.63], amp=0.05, bright=0.15)
add_footsteps(21.5, 24.8, 0.42, 0.05, wet=False)

# =========================================================
# SCENE 2 (27 - 54s): Ruined Colorful City, Fires & Falling Sign
# =========================================================
for k, ch in enumerate([
    [110.0, 130.81, 164.81, 220.0],
    [87.31, 130.81, 174.61, 207.65],
    [98.00, 146.83, 196.00, 233.08],
    [82.41, 123.47, 164.81, 196.00],
]):
    synth_pad_chord(27.0 + k * 6.8, 7.2, ch, amp=0.058, bright=0.28)

# Crackling Fire Ambience (27s -> 54s)
fire_len = int(27.0 * SR)
fire_noise = rng.normal(0, 1, fire_len).astype(np.float32)
fire_rumble = np.convolve(fire_noise, np.ones(60, dtype=np.float32)/60.0, mode='same') * 0.035
crackle_mask = (rng.random(fire_len) > 0.9985).astype(np.float32)
crackles = np.convolve(crackle_mask * rng.uniform(0.2, 1.0, fire_len).astype(np.float32), np.exp(-np.arange(180)/35.0).astype(np.float32), mode='same') * 0.09
add_st(27.0, fire_rumble + crackles, fire_rumble * 0.95 + np.roll(crackles, 400))
add_footsteps(28.0, 39.5, 0.36, 0.05)

# 40.5s: Falling Colorful Sign Metal Screech + Crash Impact!
cr_len = int(1.8 * SR)
ct = np.arange(cr_len, dtype=np.float32) / SR
crash = rng.normal(0, 1, cr_len).astype(np.float32) * np.exp(-ct * 4.5) * 0.26
clang = (np.sin(2 * np.pi * 380 * ct) + np.sin(2 * np.pi * 615 * ct)) * np.exp(-ct * 7.0) * 0.14
add_st(40.7, crash + clang, crash * 0.9 + clang * 1.1)
add_taiko_hit(40.72, 0.32)

# =========================================================
# SCENE 3 (54 - 82s): Scavenging Food/Water & Creature Stealth
# =========================================================
for k, ch in enumerate([
    [98.0, 116.54, 146.83, 207.65],
    [92.5, 110.0, 138.59, 196.0],
    [98.0, 116.54, 146.83, 220.0],
    [82.41, 123.47, 155.56, 185.0],
]):
    synth_pad_chord(54.0 + k * 7.0, 7.4, ch, amp=0.052, bright=0.18)

add_footsteps(55.0, 62.0, 0.45, 0.045)

# 64.5s..74.0s: Eerie Alien/Mutant Creature Growls & Chittering
for gt in [64.4, 67.8, 71.2, 76.5]:
    gL = int(1.3 * SR)
    lt = np.arange(gL, dtype=np.float32) / SR
    gf = 78.0 + 24.0 * np.sin(2 * np.pi * 19.0 * lt)
    growl = (np.sin(2 * np.pi * np.cumsum(gf) / SR) + 0.5 * np.sin(4 * np.pi * np.cumsum(gf) / SR)) * make_env(gL, 0.12, 0.35) * 0.11
    add_st(gt, growl * 0.9, growl * 1.05)

# 76.2s: Thrown Metal Can Clatter + Escape Sprint
canL = int(0.6 * SR)
cnt = np.arange(canL, dtype=np.float32) / SR
can_sig = (np.sin(2 * np.pi * 920 * cnt) + np.sin(2 * np.pi * 1390 * cnt)) * np.exp(-cnt * 14.0) * 0.12
add_st(76.15, can_sig * 0.4, can_sig * 1.1)
add_footsteps(77.0, 81.8, 0.22, 0.065)

# =========================================================
# SCENE 4 (82 - 110s): Superstorm, Flooded Run, Building Climb & Debris
# =========================================================
# Heavy Stereo Rain + Rushing Floodwater (82s -> 110s)
rain_len = int(28.0 * SR)
r_l = rng.normal(0, 1, rain_len).astype(np.float32)
r_r = rng.normal(0, 1, rain_len).astype(np.float32)
rain_l = np.diff(r_l, prepend=0) * 0.042 + np.convolve(r_l, np.ones(25, dtype=np.float32)/25.0, mode='same') * 0.038
rain_r = np.diff(r_r, prepend=0) * 0.042 + np.convolve(r_r, np.ones(25, dtype=np.float32)/25.0, mode='same') * 0.038
rain_env = make_env(rain_len, 1.0, 1.2)
add_st(82.0, rain_l * rain_env, rain_r * rain_env)

# Thunderclaps (83.2s, 93.5s, 102.0s)
for th_t in [83.2, 93.5, 102.0]:
    tL = int(2.8 * SR)
    tt = np.arange(tL, dtype=np.float32) / SR
    th = np.convolve(rng.normal(0, 1, tL).astype(np.float32), np.ones(45, dtype=np.float32)/45.0, mode='same')
    th *= np.exp(-tt * 1.65) * 0.28
    add_st(th_t, th, np.roll(th, 300))

# Urgent Action Taiko Drums + Minor Brass Chords (82s -> 110s)
for k, ch in enumerate([
    [110.0, 164.81, 220.0, 261.63, 329.63],
    [130.81, 196.0, 261.63, 311.13, 392.0],
    [146.83, 220.0, 293.66, 349.23, 440.0],
    [123.47, 185.0, 246.94, 293.66, 369.99],
]):
    synth_pad_chord(82.0 + k * 7.0, 7.2, ch, amp=0.068, bright=0.45)

for beat_t in np.arange(82.5, 109.5, 0.55):
    add_taiko_hit(beat_t, 0.20 if int((beat_t - 82.5)/0.55) % 2 == 0 else 0.11)

# Splashy Floodwater Sprinting (82.5s -> 91.0s) + Ladder Rung Clangs (92.0s -> 101.0s)
add_footsteps(82.5, 91.0, 0.25, 0.07, wet=True)
for rg_t in np.arange(92.0, 101.0, 0.42):
    cL = int(0.14 * SR)
    ct = np.arange(cL, dtype=np.float32) / SR
    rung = (np.sin(2 * np.pi * 760 * ct) + 0.5 * np.sin(2 * np.pi * 1180 * ct)) * np.exp(-ct * 26.0) * 0.07
    add_st(rg_t, rung, rung * 0.9)

# Falling Debris Crashes (103.2s, 105.0s)
add_taiko_hit(103.2, 0.30)
add_taiko_hit(105.0, 0.32)

# =========================================================
# SCENE 5 (110 - 136s): Mysterious Underground Shelter Discovery
# =========================================================
# 114.2s: Heavy Steel Hatch Creak + Thud
hL = int(1.6 * SR)
ht = np.arange(hL, dtype=np.float32) / SR
creak = np.sin(2 * np.pi * np.cumsum(260 + 70 * np.sin(2 * np.pi * 3.5 * ht)) / SR) * make_env(hL, 0.15, 0.3) * 0.065
add_st(114.0, creak, creak * 0.85)
add_taiko_hit(115.6, 0.18)

# Warm Wonder Synth Pad in Underground Bunker (116s -> 135s)
for k, ch in enumerate([
    [130.81, 196.00, 246.94, 329.63, 392.00],
    [146.83, 220.00, 277.18, 369.99, 440.00],
    [130.81, 196.00, 261.63, 329.63, 493.88],
]):
    synth_pad_chord(116.0 + k * 6.5, 7.0, ch, amp=0.06, bright=0.22)

# 125.2s: Battery Power-Up Rising Chime
pL = int(1.0 * SR)
pt = np.arange(pL, dtype=np.float32) / SR
pwr = np.sin(2 * np.pi * np.cumsum(220 + 660 * pt) / SR) * make_env(pL, 0.05, 0.35) * 0.08
add_st(125.2, pwr, pwr)

# 134.8s: Sudden Red Proximity Bunker Alarm!
for al_t in [134.8, 135.4]:
    aL = int(0.35 * SR)
    at = np.arange(aL, dtype=np.float32) / SR
    alm = (np.sin(2 * np.pi * 880 * at) + 0.4 * np.sin(2 * np.pi * 1760 * at)) * make_env(aL, 0.02, 0.08) * 0.11
    add_st(al_t, alm, alm)

# =========================================================
# SCENE 6 (136 - 165s): Creature Breach, Electric Trap & Escape!
# =========================================================
for k, ch in enumerate([
    [110.0, 155.56, 220.0, 261.63, 311.13],
    [116.54, 174.61, 233.08, 293.66, 349.23],
    [123.47, 185.0, 246.94, 311.13, 369.99],
    [110.0, 164.81, 220.0, 277.18, 329.63],
]):
    synth_pad_chord(136.0 + k * 7.2, 7.5, ch, amp=0.072, bright=0.5)

for beat_t in np.arange(136.2, 163.5, 0.42):
    add_taiko_hit(beat_t, 0.22 if int((beat_t - 136.2)/0.42) % 2 == 0 else 0.12)

for gt in [137.5, 146.6, 148.2]:
    gL = int(1.1 * SR)
    lt = np.arange(gL, dtype=np.float32) / SR
    gf = 85.0 + 35.0 * np.sin(2 * np.pi * 24.0 * lt)
    growl = np.sin(2 * np.pi * np.cumsum(gf) / SR) * make_env(gL, 0.08, 0.25) * 0.13
    add_st(gt, growl, growl * 0.9)

# 150.0s..152.3s: HIGH-VOLTAGE ELECTRIC TRAP ZAP!
zL = int(2.3 * SR)
zt = np.arange(zL, dtype=np.float32) / SR
buzz = np.sign(np.sin(2 * np.pi * 120 * zt + 3 * np.sin(2 * np.pi * 37 * zt))).astype(np.float32) * 0.065
sparks = (rng.random(zL) > 0.96).astype(np.float32) * rng.uniform(-1, 1, zL).astype(np.float32) * 0.22
zap_env = make_env(zL, 0.04, 0.25)
add_st(150.0, (buzz + sparks) * zap_env, (buzz * 0.9 - sparks) * zap_env)

# 152.5s: COLORFUL FUEL BARREL EXPLOSION BOOM!
exL = int(2.8 * SR)
ext = np.arange(exL, dtype=np.float32) / SR
ex_sub = np.sin(2 * np.pi * np.cumsum(30 + 110 * np.exp(-ext * 10.0)) / SR) * np.exp(-ext * 2.2) * 0.38
ex_roar = np.convolve(rng.normal(0, 1, exL).astype(np.float32), np.ones(32, dtype=np.float32)/32.0, mode='same') * np.exp(-ext * 2.8) * 0.30
add_st(152.5, ex_sub + ex_roar, ex_sub + np.roll(ex_roar, 220))

add_footsteps(157.0, 164.5, 0.26, 0.055)

# =========================================================
# FINAL SCENE (165 - 192s): Sunrise Green Mountain, Radio Signal & Fade to Black
# =========================================================
# Soaring Emotional Major/Lydian Sunrise Orchestral Chords
sunrise_chords = [
    (165.0, 7.0, [130.81, 196.00, 261.63, 329.63, 392.00, 493.88]),  # Cmaj7
    (171.5, 7.0, [174.61, 220.00, 261.63, 329.63, 392.00, 523.25]),  # Fmaj9
    (178.0, 7.0, [220.00, 261.63, 329.63, 392.00, 493.88, 659.25]),  # Am9 hopeful
    (184.5, 7.5, [130.81, 196.00, 261.63, 329.63, 392.00, 523.25]),  # Cmaj(add9) grand resolve
]
for st_s, d_s, ch in sunrise_chords:
    synth_pad_chord(st_s, d_s, ch, amp=0.068, bright=0.35)

# Morning birds on green mountain (166s -> 176s)
for bt in [166.5, 168.8, 171.2, 174.0]:
    add_bird_chirp(bt, 2500 + (bt * 90) % 400, 0.024)

# 176.5s -> 188.8s: MYSTERIOUS RADIO SIGNAL (Crackle + Ethereal Harmonic Beacon Motif!)
rad_len = int(12.2 * SR)
rt = np.arange(rad_len, dtype=np.float32) / SR
static_bed = rng.normal(0, 1, rad_len).astype(np.float32) * 0.012 * make_env(rad_len, 0.5, 1.5)
add_st(176.5, static_bed, static_bed * 0.9)

# Repeating mysterious 5-tone radio beacon (G5 - A5 - E5 - C6 - B5) + Morse pips
beacon_notes = [
    (0.0, 0.22, 783.99),
    (0.32, 0.22, 880.00),
    (0.68, 0.35, 659.25),
    (1.18, 0.28, 1046.50),
    (1.58, 0.65, 987.77),
]
for cycle_start in [176.8, 180.4, 184.2, 187.4]:
    for off, ndur, nf in beacon_notes:
        if cycle_start + off + ndur > 190.2:
            continue
        nL = int(ndur * SR)
        nt = np.arange(nL, dtype=np.float32) / SR
        tone = (np.sin(2 * np.pi * nf * nt) + 0.25 * np.sin(2 * np.pi * nf * 2.0 * nt)) * make_env(nL, 0.015, 0.12) * 0.062
        add_st(cycle_start + off, tone * 0.85, tone * 1.0)
        # Subtle space echo
        add_st(cycle_start + off + 0.24, tone * 0.32, tone * 0.28)

# Lush Stereo Reverb + Clean Fade-In (0..1.2s) & Fade-Out to Silence (189.0..192.0s)
d1, d2 = int(0.13 * SR), int(0.21 * SR)
left[d1:] += right[:-d1] * 0.16
right[d2:] += left[:-d2] * 0.16

fi = int(1.0 * SR)
fo = int(3.0 * SR)
left[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
right[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
left[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32) ** 1.5
right[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32) ** 1.5

peak = max(float(np.max(np.abs(left))), float(np.max(np.abs(right))), 1e-6)
left = np.tanh((left / peak) * 1.3) / np.tanh(1.3) * 0.86
right = np.tanh((right / peak) * 1.3) / np.tanh(1.3) * 0.86

pcm = np.empty((N, 2), dtype=np.int16)
pcm[:, 0] = np.clip(left * 32767.0, -32767, 32767).astype(np.int16)
pcm[:, 1] = np.clip(right * 32767.0, -32767, 32767).astype(np.int16)

out_wav = '/tmp/movie3d/apocalypse_soundtrack.wav'
with wave.open(out_wav, 'wb') as wf:
    wf.setnchannels(2)
    wf.setsampwidth(2)
    wf.setframerate(SR)
    wf.writeframes(pcm.tobytes())

print(f'Generated 192.0s Cinematic Score & Foley WAV: {out_wav}')
