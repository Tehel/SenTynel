#!/usr/bin/env python3
"""
Procedural terrain textures for the eye-candy branch.

WHY GENERATED AND NOT DOWNLOADED. The look wanted is stylized, not photographic, and the game
already has eight colour themes keyed on sentry count (engine/scene.ts `themes[]`). Sourcing
photo textures would mean four maps per theme, thirty-two files to keep visually consistent by
hand. Generating them makes a theme a handful of PARAMETERS, and the whole set is reproducible
from this file — so a tweak is an edit and a re-run, not a re-download.

WHY GREYSCALE. `MeshPhongMaterial.map` multiplies `.color`, so a greyscale albedo leaves the
existing per-theme hue in charge and every theme inherits the texture for free. Mean level is
held near MEAN_LEVEL so applying a map does not darken the terrain out of the lighting
calibration recorded in CLAUDE.md (ambient 0.7 / specular 0x808080).

SEAMLESS BY CONSTRUCTION. Every noise primitive here is periodic — the value-noise lattice wraps
and the worley feature grid is toroidal — so tiles abut with no seam at any octave. This is the
part that is tedious to get right by hand and trivial to get right in code, which is most of the
argument for doing it this way.

  python3 utils/gen-textures.py            # -> public/tex/*.png, then webp via ImageMagick
  python3 utils/gen-textures.py --size 256

Texel density is 64px per world tile (one tile = one world unit), so the default 512 covers 8
tiles before repeating. See the plan's "Density" decision.
"""
import argparse, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image

TILES = 8              # world tiles across one texture
NORMAL_DIVISOR = 2     # normal maps ship at 1/N the albedo resolution — see main()
MEAN_LEVEL = 0.90      # target mean albedo multiplier — keeps the lighting calibration usable
OUT = Path(__file__).resolve().parent.parent / 'public' / 'tex'


def _smooth(t):
    # Perlin's quintic — C2 continuous, so fbm octaves do not show lattice creases.
    return t * t * t * (t * (t * 6 - 15) + 10)


def value_noise(n, period, rng, period_x=None):
    """
    Periodic value noise at `n`x`n`. Wraps exactly.

    `period_x` gives the lattice a different frequency along x, which is what makes ANISOTROPIC
    noise possible: a fine period across and a coarse one along produces stretched fibre rather
    than isotropic mush. The first grass attempt had no such term and read as cloud, not grass.
    """
    period_x = period if period_x is None else period_x
    lat = rng.random((period, period_x))
    ys = np.arange(n) * period / n
    xs = np.arange(n) * period_x / n
    y0 = np.floor(ys).astype(int) % period
    x0 = np.floor(xs).astype(int) % period_x
    y1 = (y0 + 1) % period
    x1 = (x0 + 1) % period_x
    fy = _smooth(ys - np.floor(ys))[:, None]
    fx = _smooth(xs - np.floor(xs))[None, :]
    a = lat[np.ix_(y0, x0)]
    b = lat[np.ix_(y0, x1)]
    c = lat[np.ix_(y1, x0)]
    d = lat[np.ix_(y1, x1)]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(n, base_period, octaves, rng, gain=0.5):
    out = np.zeros((n, n))
    amp, total, period = 1.0, 0.0, base_period
    for _ in range(octaves):
        out += amp * value_noise(n, period, rng)
        total += amp
        amp *= gain
        period *= 2
    return out / total


def worley(n, cells, rng, jitter=0.85):
    """
    Periodic cellular noise, toroidal. Returns (F1, F2, WHO) — distance to the nearest and second
    nearest feature point, and a per-pixel index identifying the nearest.

    F2-F1 goes to zero exactly on the boundary between two cells, which is what draws the CRACKS
    between plates. WHO indexes a per-seed random table to give each plate a FLAT value, which is
    what makes rock read as facets rather than as the rounded pillows a raw distance field gives.

    Only the 3x3 block of cells around each pixel is searched. The naive version compared every
    pixel against every seed, which is O(cells^2 * n^2) — fine at 512px with 16 cells, and minutes
    at 1024px with 48. With jitter <= 1 a seed cannot escape its own cell, so the nearest two are
    always inside that block and the shortcut is exact, not an approximation.
    """
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing='ij'), -1)
           + 0.5 + (rng.random((cells, cells, 2)) - 0.5) * jitter) / cells
    g = (np.arange(n) + 0.5) / n
    py, px = np.meshgrid(g, g, indexing='ij')
    cy = np.floor(py * cells).astype(int) % cells
    cx = np.floor(px * cells).astype(int) % cells

    f1 = np.full((n, n), 10.0)
    f2 = np.full((n, n), 10.0)
    who = np.zeros((n, n), dtype=np.int32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ny = (cy + dy) % cells
            nx = (cx + dx) % cells
            sy = pts[ny, nx, 0]
            sx = pts[ny, nx, 1]
            ddy = np.abs(py - sy); ddy = np.minimum(ddy, 1 - ddy)
            ddx = np.abs(px - sx); ddx = np.minimum(ddx, 1 - ddx)
            d = np.hypot(ddy, ddx)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            who = np.where(closer, ny * cells + nx, who)
            f1 = np.where(closer, d, f1)
    return f1, f2, who


def normalise(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)


def to_albedo(height, contrast):
    """Height field -> greyscale albedo held around MEAN_LEVEL."""
    a = normalise(height)
    a = MEAN_LEVEL + (a - a.mean()) * contrast
    return np.clip(a, 0.0, 1.0)


def blur_wrap(a, radius):
    """Separable box blur with wraparound, so the field stays seamless."""
    if radius <= 0:
        return a
    k = int(radius)
    out = a
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for d in range(-k, k + 1):
            acc += np.roll(out, d, axis)
        out = acc / (2 * k + 1)
    return out


def normal_map(height, strength):
    """Sobel over a wrapped height field -> tangent-space normal map."""
    h = normalise(height)
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    ln = np.sqrt(dx * dx + dy * dy + nz * nz)
    # Three expects +Y up in tangent space; the row axis runs the other way, hence -dy.
    return np.stack([(-dx / ln * 0.5 + 0.5), (-dy / ln * 0.5 + 0.5), (nz / ln * 0.5 + 0.5)], -1)


# --- surfaces -------------------------------------------------------------------------------
# Each returns a HEIGHT field; albedo and normal are both derived from it, which is what keeps
# the shading and the tone agreeing with each other.

def grass(n, rng):
    """
    Turf seen from standing height: mottled clumps with short blade speckle.

    The first attempt drew long, smooth, uniformly-aligned fibre, which under a moving specular
    highlight read as flowing water rather than grass. From a synthoid's eye a blade is a couple
    of pixels, so the fibre here is SHORT and its direction varies per clump — the texture carries
    mottle at tile scale and speckle below it, and nothing long enough to catch a sheen.
    """
    clump = fbm(n, TILES, 4, rng)                       # patches about a tile across
    mottle = fbm(n, TILES * 4, 3, rng)
    # Short blades in two crossing directions, so no single grain direction dominates.
    blade_v = value_noise(n, TILES * 16, rng, period_x=TILES * 40)
    blade_h = value_noise(n, TILES * 40, rng, period_x=TILES * 16)
    speckle = np.maximum(blade_v, blade_h)
    h = clump * 0.40 + mottle * 0.26 + speckle * 0.34
    return normalise(h) ** 1.2


def rock(n, rng):
    """
    Shattered rock: flat facets separated by hard cracks.

    Two earlier attempts failed the same way. Distance-field worley (F1, or F2-F1 alone) domes
    every cell, so the surface read first as foam and then as bubble wrap — rounded, wet, and at
    odds with a game rendered entirely in flat-shaded facets. Keying a random level off the
    nearest-seed INDEX makes each plate perfectly flat, so the only relief is at the breaks. That
    is both more like rock and more like the rest of the game.
    """
    f1a, f2a, who_a = worley(n, TILES * 6, rng, jitter=1.0)
    f1b, f2b, who_b = worley(n, TILES * 2, rng, jitter=1.0)
    # Flat level per facet, at two scales: big slabs, each broken into smaller plates.
    slab = rng.random(TILES * 2 * TILES * 2)[who_b]
    plate = rng.random(TILES * 6 * TILES * 6)[who_a]
    # Cracks: F2-F1 goes to zero exactly on a cell boundary. Sharpen hard so they are lines.
    crack_a = np.clip(normalise(f2a - f1a) * 7.0, 0, 1)
    crack_b = np.clip(normalise(f2b - f1b) * 6.0, 0, 1)
    grain = fbm(n, TILES * 14, 3, rng)
    # NO BEDDING TERM. A sin() of the row was tried to suggest sedimentary layering and had to go:
    # it is a function of one axis only, so under the top-down world-XZ projection the terrain uses
    # it painted dead-straight lines of highlights across the landscape, cutting over slopes and
    # tiles alike. Visible as a diagonal chain of bright dashes on any large slope. Strata only make
    # sense on a vertical face, and this game has none.
    h = slab * 0.30 + plate * 0.28 + crack_a * 0.17 + crack_b * 0.15 + grain * 0.10
    return normalise(h)


def metal(n, rng):
    """
    Riveted plate. Panels about half a tile across, a bolt at every panel corner, brushed grain
    within.

    Bolts and seams are drawn ANALYTICALLY off a periodic grid rather than sampled from noise — a
    rivet has to be a circle of a definite size in a definite place, and no amount of fbm gives you
    that. The grid period divides TILES exactly, so the pattern stays seamless and lands the same
    way on every tile.

    Note MAXIMUM, not minimum, over the two axis distances. min() is true near a seam on EITHER
    axis, which sounds right and is not: it selects the cell centres, so the first version drew
    grooves only at the panel corners and the grid was invisible.
    """
    PANEL = 2                                            # panels across one world tile
    BOLT_R = 0.15                                        # bolt radius, in panel-cell units
    cells = TILES * PANEL
    g = (np.arange(n) + 0.5) / n
    py, px = np.meshgrid(g, g, indexing='ij')
    # 0 at a panel's centre line, 1 at its edge, per axis.
    ey = np.abs((py * cells) % 1.0 - 0.5) * 2
    ex = np.abs((px * cells) % 1.0 - 0.5) * 2
    edge = np.maximum(ey, ex)
    groove = np.clip((edge - 0.86) / 0.14, 0, 1)

    # Distance to the nearest lattice corner, in cell units — bolts sit where four panels meet.
    cy = np.abs((py * cells + 0.5) % 1.0 - 0.5)
    cx = np.abs((px * cells + 0.5) % 1.0 - 0.5)
    d = np.hypot(cy, cx)
    # sqrt profile domes the stud instead of coning it, so the sun glints off a rounded head.
    bolt = np.sqrt(np.clip(1.0 - d / BOLT_R, 0, 1))

    brushed = value_noise(n, TILES * 2, rng, period_x=TILES * 60)
    scratch = np.clip(normalise(value_noise(n, TILES, rng, period_x=TILES * 110)) - 0.80, 0, 1) * 4
    plate_tone = rng.random(cells * cells)[
        ((py * cells).astype(int) % cells) * cells + ((px * cells).astype(int) % cells)]
    # Plate faces flat and near the top of the range; the grooves cut down, the bolts stand proud.
    h = 0.62 - groove * 0.34 + bolt * 0.30 + brushed * 0.05 + scratch * 0.04 + plate_tone * 0.06
    return normalise(h)


def organic(n, rng):
    """
    Living tissue: swollen cells under a membrane, with a vein network between them.

    Uses worley the opposite way round to rock — the cell interiors are DOMED (raw F1) rather than
    flat, because the thing being suggested here is turgor, not fracture. The veins come from
    ridged noise, which puts a crest where plain fbm would put a slope.
    """
    f1, f2, who = worley(n, TILES * 4, rng, jitter=1.0)
    # Domed cells: F1 rises from each seed, so inverting it swells the middle of every cell.
    swell = 1.0 - normalise(f1)
    membrane = np.clip(normalise(f2 - f1) * 5.0, 0, 1)
    # Ridged noise: folding fbm about its midpoint turns smooth humps into creases.
    veins = 1.0 - np.abs(fbm(n, TILES * 2, 4, rng) * 2 - 1)
    veins = normalise(veins) ** 2.2
    pores = np.clip(normalise(value_noise(n, TILES * 18, rng)) - 0.66, 0, 1) * 3
    h = swell * 0.40 + membrane * 0.16 + veins * 0.28 + pores * 0.16
    return normalise(h)


def sand(n, rng):
    """
    Wind-rippled sand: meandering ridges, fine grain, a scatter of pebbles.

    The ripples are a sin() of a linear phase, which is exactly the construction that ruined the
    rock (see the note in rock() about bedding). It is safe HERE only because the phase is warped
    hard by 2D noise before the sine sees it, so the crests meander the way real ripples do instead
    of ruling straight lines across the landscape. The linear term uses a whole number of cycles so
    the pattern still wraps.
    """
    RIPPLE_CYCLES = TILES * 3
    g = (np.arange(n) + 0.5) / n
    py, px = np.meshgrid(g, g, indexing='ij')
    warp = fbm(n, TILES, 4, rng) * 2.6 + fbm(n, TILES * 3, 3, rng) * 0.9
    phase = (py * 0.82 + px * 0.57) * 2 * np.pi * RIPPLE_CYCLES + warp * 2 * np.pi
    ripple = (np.sin(phase) * 0.5 + 0.5) ** 1.5          # crests sharper than troughs
    drift = fbm(n, TILES, 3, rng)                         # broad dune shading
    grain = fbm(n, TILES * 26, 2, rng)
    # Sparse pebbles: threshold a mid-frequency field so only the peaks survive, then dome them.
    peb_f1, _, _ = worley(n, TILES * 5, rng, jitter=1.0)
    pebble = np.sqrt(np.clip(1.0 - normalise(peb_f1) / 0.22, 0, 1)) \
        * (normalise(value_noise(n, TILES * 5, rng)) > 0.80)
    h = ripple * 0.34 + drift * 0.30 + grain * 0.22 + pebble * 0.14
    return normalise(h)


def concrete(n, rng):
    """
    Poured concrete: form-board seams, exposed aggregate, staining, hairline cracks.

    Straight seams are wanted here, unlike in rock. On a man-made surface an aligned grid reads as
    construction — the shuttering really was straight — where on stone the same lines read as a
    rendering bug. Same reasoning as metal().
    """
    BOARD = 1                                            # form panels per world tile
    cells = TILES * BOARD
    g = (np.arange(n) + 0.5) / n
    py, px = np.meshgrid(g, g, indexing='ij')
    ey = np.abs((py * cells) % 1.0 - 0.5) * 2
    ex = np.abs((px * cells) % 1.0 - 0.5) * 2
    seam = np.clip((np.maximum(ey, ex) - 0.93) / 0.07, 0, 1)
    # Aggregate: small stones just under the surface, so a gentle dome rather than a hard edge.
    ag_f1, _, _ = worley(n, TILES * 9, rng, jitter=1.0)
    aggregate = np.clip(1.0 - normalise(ag_f1) / 0.5, 0, 1) ** 1.6
    stain = fbm(n, TILES, 4, rng)                         # damp patches and pour variation
    # Hairline cracks: the cell boundaries of a coarse worley, kept thin and only where a mask lets
    # them through, so the surface is not uniformly crazed.
    cf1, cf2, _ = worley(n, TILES * 2, rng, jitter=1.0)
    crack = np.clip(1.0 - normalise(cf2 - cf1) * 26.0, 0, 1)
    crack *= (fbm(n, TILES, 3, rng) > 0.52)
    grain = fbm(n, TILES * 18, 2, rng)
    h = 0.55 - seam * 0.22 - crack * 0.30 + aggregate * 0.16 + stain * 0.20 + grain * 0.10
    return normalise(h)


def wood(n, rng):
    """
    Sawn timber: boards running one way, fine fibrous grain along them, a joint at every edge.

    Reported by a player as "molten chocolate", and that was exactly right. The grain was a smooth
    sinusoid — wide wavy bands — carried by a strong normal map, so it read as something poured
    and set rather than something cut. Real grain is FIBROUS: many tight lines running the length
    of the board, dark and thin, with the figure widening only where it passes a knot.

    Three changes follow from that. The rings are much finer and sharpened with a fractional power
    so they dip to thin dark lines instead of rolling; a lengthwise fibre term runs with them; and
    the warp is halved so the lines follow the board rather than wandering across it. The relief
    is separately blurred hard (see SURFACES) so the shading shows the JOINTS, which are real
    steps, and not the grain, which is colour on a flat surface.
    """
    BOARDS = 3                                           # boards across one world tile
    rows_n = TILES * BOARDS
    g = (np.arange(n) + 0.5) / n
    py, px = np.meshgrid(g, g, indexing='ij')
    board_f = (py * rows_n) % 1.0
    board_i = np.floor(py * rows_n).astype(int) % rows_n

    # Joints: thin dark lines, long edges and staggered ends.
    gap = np.clip(np.abs(board_f - 0.5) * 2 - 0.90, 0, 1) / 0.10
    stagger = (board_i % 2) * 0.5
    end_f = (px * TILES + stagger) % 1.0
    end_gap = np.clip(np.abs(end_f - 0.5) * 2 - 0.975, 0, 1) / 0.025

    # Grain: |sin| raised to a fractional power sits near the top of its range for most of a cycle
    # and plunges at the zero crossings, which is a thin dark line rather than a rolling band.
    pith = rng.random(rows_n)[board_i] * 1.6 - 0.3
    along = fbm(n, TILES * 2, 4, rng) * 0.7 + fbm(n, TILES, 2, rng) * 0.4
    r = np.abs(board_f - pith) ** 0.80
    rings = np.abs(np.sin((r * 11.0 + along) * 2 * np.pi)) ** 0.35
    # Fibre running the LENGTH of each board: many lattice cells across, few along.
    fibre = value_noise(n, TILES * 34, rng, period_x=TILES * 2)
    tone = rng.random(rows_n)[board_i]                   # each board a slightly different timber
    h = 0.40 + rings * 0.22 + fibre * 0.16 + tone * 0.12 - gap * 0.40 - end_gap * 0.30 \
        + fbm(n, TILES * 22, 2, rng) * 0.05
    return normalise(h)


def hull(n, rng):
    """
    Machined hull plate for the animate models — grain with NO macro structure.

    metal() was tried on them first and was wrong at that size. Its panel grid and rivets are
    scaled to a world tile, and a synthoid is under half a unit across, so four panels landed on a
    figure the size of a thumb and read as a dark grid stamped on everything alive. The surfaces
    that worked on the boulder, tree and pedestal all share one property: irregular structure with
    no repeating unit big enough to be seen as a pattern. This is built to that rule — anisotropic
    brushing, faint mottle, micro speckle, and nothing that lines up.
    """
    brushed = value_noise(n, TILES * 3, rng, period_x=TILES * 70)
    cross = value_noise(n, TILES * 70, rng, period_x=TILES * 3)
    mottle = fbm(n, TILES * 5, 4, rng)
    speck = np.clip(normalise(value_noise(n, TILES * 30, rng)) - 0.74, 0, 1) * 3
    h = brushed * 0.44 + cross * 0.12 + mottle * 0.30 + speck * 0.14
    return normalise(h)


SURFACES = {
    # name: (height fn, albedo contrast, normal strength, relief blur radius in px)
    # Normal strength is deliberately low. The first pass used 7 and 11 and the specular term
    # turned both surfaces into water — a moving sun over strong relief plus MeshPhongMaterial's
    # broad highlight reads as wet, not rough. These give relief without the sheen.
    # Grass: relief comes from clump-scale undulation, not from blades. Strength raised from the
    # 1.0 it was dropped to after the 'wet grass' failure — that came from strong normals on long
    # smooth streaks, which the short cross-grained speckle no longer produces.
    'grass': (grass, 0.34, 3.2, 7),
    'rock': (rock, 0.42, 3.0, 1),
    # Metal earns a stronger normal than the natural surfaces: bolts and seams are supposed to
    # catch the moving sun, and that read is the whole point of putting rivets on a slope.
    'metal': (metal, 0.46, 4.5, 0),
    'organic': (organic, 0.38, 2.6, 2),
    'sand': (sand, 0.30, 2.6, 3),
    'concrete': (concrete, 0.32, 2.4, 1),
    # Relief blurred hard and weakened: the joints are real steps, the grain is not. A strong
    # normal over the grain is what made this look poured rather than sawn.
    'wood': (wood, 0.34, 1.5, 6),
    # Low contrast on purpose: this sits on small objects that already carry per-face colour.
    'hull': (hull, 0.22, 1.4, 2),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=TILES * 64, help='pixels square (default 512 = 64px/tile)')
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--only', default=None)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    n = args.size
    for name, (fn, contrast, strength, relief_blur) in SURFACES.items():
        if args.only and name != args.only:
            continue
        rng = np.random.default_rng(args.seed + sum(map(ord, name)))
        h = fn(n, rng)
        alb = to_albedo(h, contrast)
        """
        RELIEF IS NOT ALWAYS THE ALBEDO'S FIELD. Blurring the height before taking normals keeps
        the coarse structure — clumps, plates, dunes — and drops the pixel-scale grain.

        Grass needed this. Its height is dominated by blade speckle, so its normals perturbed at
        pixel scale and the relief toggle produced a fine shimmer rather than any legible form:
        measurably a bigger change than the slopes got, and yet read as "the floors are not
        affected". The albedo still carries every blade; only the shading is coarsened, which is
        also physically the right story — turf undulates at the scale of clumps, not blades.
        """
        nrm = normal_map(blur_wrap(h, relief_blur), strength)
        Image.fromarray((alb * 255).astype(np.uint8), 'L').save(OUT / f'{name}_a.png')
        # Normal maps ship at half the albedo's resolution. They were 70% of the texture payload at
        # full size (1.06 MB of 1.5 MB) and they are the map that can least afford it: relief here
        # is broad — plate faces, bolt heads, turf clumps — while the fine grain that actually needs
        # the pixels lives in the albedo. The GPU filters the difference away.
        nrm_img = Image.fromarray((nrm * 255).astype(np.uint8), 'RGB')
        nrm_img = nrm_img.resize((n // NORMAL_DIVISOR, n // NORMAL_DIVISOR), Image.LANCZOS)
        nrm_img.save(OUT / f'{name}_n.png')
        for suffix in ('a', 'n'):
            src = OUT / f'{name}_{suffix}.png'
            subprocess.run(['convert', str(src), '-quality', '92', str(src.with_suffix('.webp'))], check=True)
            src.unlink()
        print(f'{name}: {n}x{n} ({n // TILES}px/tile) mean {alb.mean():.3f} '
              f'range {alb.min():.2f}-{alb.max():.2f}')


if __name__ == '__main__':
    main()
