/*
 Generate the object models in src/world/objects/models/*.ts.

 WHY A GENERATOR. The model format is a hand-maintained list of vertices and 1-based triangle
 indices with a flat colour per face (see models/index.ts). That is fine for the 12-triangle
 boulder the game shipped with and hopeless for anything detailed — the old pipeline was "export
 an .obj, run utils/obj-shrink.js, transcribe by hand and re-assign every face colour", which is
 both laborious and unreviewable. Built from primitives instead, a model is a few lines that say
 what it IS, a change is an edit and a re-run, and the numbers are always consistent.

 WHAT MUST NOT CHANGE. These are the DRAWN shapes only. The shapes that answer raycasts are the
 originals, kept as occluders (models/index.ts's getOccluder), so silhouette changes here cannot
 move a line of sight. Two things still matter visually:
   - stacking heights: a boulder's top face must sit at exactly BOULDER_RISE (0.5) and a
     pedestal's at PEDESTAL_RISE (1.0), or things placed on them float or sink;
   - the overall envelope should stay close to the occluder, so the crosshair and the drawn
     model agree about where a thing is.

   node utils/gen-models.mjs
*/
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '..', 'src', 'world', 'objects', 'models');

// ---- primitives ---------------------------------------------------------------------------
// Every builder pushes into a shared {v, f} accumulator. Vertices are deduplicated on exact
// coordinates, which keeps the files small without an obj-shrink pass.
function Model() {
	const v = [];
	const f = [];
	const index = new Map();
	const R = n => Math.round(n * 4096) / 4096;      // tidy binary fractions, like the originals
	const vert = (x, y, z) => {
		const key = `${R(x)},${R(y)},${R(z)}`;
		if (index.has(key)) return index.get(key);
		v.push([R(x), R(y), R(z)]);
		index.set(key, v.length);
		return v.length;                              // 1-based, OBJ convention
	};
	const tri = (a, b, c, color) => f.push({ v: [a, b, c], color });
	const quad = (a, b, c, d, color) => { tri(a, b, c, color); tri(a, c, d, color); };
	return { v, f, vert, tri, quad,
		// A ring of n points at radius r, height y, optionally spun by `phase` turns.
		ring(n, r, y, phase = 0, sx = 1, sz = 1) {
			return Array.from({ length: n }, (_, i) => {
				const a = ((i + phase) / n) * Math.PI * 2;
				return vert(Math.sin(a) * r * sx, y, Math.cos(a) * r * sz);
			});
		},
		/*
		 An 8-point ring shaped as a CHAMFERED SQUARE — points at (±hw, ±c) and (±c, ±hw) — rather
		 than a regular octagon. It matters for the pedestal: a regular octagon inscribed in the
		 same bounding box leaves the four corners empty, and since the pedestal's occluder is a
		 full square those empty corners are exactly where you can see through the drawn model and
		 still be refused by the crosshair.
		*/
		squareRing(hw, c, y) {
			return [
				vert(c, y, hw), vert(hw, y, c), vert(hw, y, -c), vert(c, y, -hw),
				vert(-c, y, -hw), vert(-hw, y, -c), vert(-hw, y, c), vert(-c, y, hw),
			];
		},
		/*
		 Side wall coloured by WHICH WAY IT FACES rather than by index parity: the front half takes
		 one colour, the back half another. A raptor's pale streaked breast against dark folded wings
		 is a big part of how one reads at any distance, and parity striping cannot express it.
		*/
		skirtFB(lower, upper, front, back) {
			const n = lower.length;
			for (let i = 0; i < n; i++) {
				const j = (i + 1) % n;
				const zMid = (v[lower[i] - 1][2] + v[lower[j] - 1][2]) / 2;
				quad(lower[i], lower[j], upper[j], upper[i], zMid >= 0 ? front : back);
			}
		},
		/*
		 A ring with independent x/z radii AND a z offset for its centre.

		 Concentric rings can only build a body that is symmetric about one vertical axis, which is
		 not what a perched bird is: the breast bulges forward while the back stays a nearly straight
		 line from crown to tail. Shifting each ring's centre as it rises is what leans the mass
		 forward, and it is the difference between an egg on end and a bird.
		*/
		ringOff(n, rx, rz, y, zOff = 0) {
			return Array.from({ length: n }, (_, i) => {
				const a = (i / n) * Math.PI * 2;
				return vert(Math.sin(a) * rx, y, Math.cos(a) * rz + zOff);
			});
		},
		/*
		 An OPEN arc rather than a closed ring — a run of points from a0 to a1 with no wrap. The hood
		 needs it: a cowl covers the back and sides of the head and is open at the face, which a
		 closed ring cannot express without building the whole shell and cutting it.
		*/
		arcOff(n, rx, rz, y, zOff, a0, a1) {
			return Array.from({ length: n + 1 }, (_, i) => {
				const a = a0 + ((a1 - a0) * i) / n;
				return vert(Math.sin(a) * rx, y, Math.cos(a) * rz + zOff);
			});
		},
		// Wall between two arcs. Unlike skirt() this does NOT wrap, so the ends stay open.
		skirtOpen(lower, upper, color, colorAlt) {
			for (let i = 0; i < lower.length - 1; i++) {
				quad(lower[i], lower[i + 1], upper[i + 1], upper[i], colorAlt && i % 2 ? colorAlt : color);
			}
		},
		// Side wall between two rings of equal length.
		skirt(lower, upper, color, colorAlt) {
			const n = lower.length;
			for (let i = 0; i < n; i++) {
				const j = (i + 1) % n;
				quad(lower[i], lower[j], upper[j], upper[i], colorAlt && i % 2 ? colorAlt : color);
			}
		},
		// Flat cap over a ring. `up` false emits the reversed winding for a floor.
		cap(r, color, up = true) {
			const c = r.length;
			for (let i = 1; i < c - 1; i++) up ? tri(r[0], r[i], r[i + 1], color) : tri(r[0], r[i + 1], r[i], color);
		},
		/*
		 Scale every vertex after the fact. Lets a model be DESIGNED at one convenient size and then
		 fitted to whatever the game wants, without threading a factor through every coordinate —
		 which for a model with a hand-built beak and eye patches would mean touching forty numbers
		 to change one.
		*/
		scaleAll(sx, sy, sz) {
			for (const pt of v) {
				pt[0] = R(pt[0] * sx);
				pt[1] = R(pt[1] * sy);
				pt[2] = R(pt[2] * sz);
			}
		},
		/*
		 Scale Y so the model's actual top lands exactly on `target`.

		 Replaces dividing by a hand-written design height, which is a guess at where the model ends
		 and was wrong twice: once when the crown turned out to sit at 1.545 rather than the 1.58 it
		 was laid out against, and again when the hood's peak pushed past both. Measuring costs one
		 pass over the vertices and cannot drift from the geometry the way a constant can — and it
		 lets the hooded and bare versions of the same bird each land on their own target without
		 needing separate constants.
		*/
		fitHeight(target) {
			let maxY = 0;
			for (const pt of v) if (pt[1] > maxY) maxY = pt[1];
			if (maxY <= 0) return;
			const k = target / maxY;
			for (const pt of v) pt[1] = R(pt[1] * k);
		},
		// Axis-aligned box, given as centre + half extents.
		box(cx, cy, cz, hx, hy, hz, color, top = color) {
			const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
			const a = vert(x0, y0, z1), b = vert(x1, y0, z1), c = vert(x1, y0, z0), d = vert(x0, y0, z0);
			const e = vert(x0, y1, z1), g = vert(x1, y1, z1), h = vert(x1, y1, z0), i = vert(x0, y1, z0);
			quad(a, b, g, e, color); quad(b, c, h, g, color);
			quad(c, d, i, h, color); quad(d, a, e, i, color);
			quad(e, g, h, i, top);   quad(d, c, b, a, color);
		},
	};
}

function emit(name, m) {
	const vs = m.v.map(p => `\t\t[${p.join(', ')}],`).join('\n');
	const fs = m.f.map(t => `\t\t{ v: [${t.v.join(', ')}], color: ${t.color} },`).join('\n');
	const body = `// GENERATED by utils/gen-models.mjs — edit that, not this file.\n` +
		`// ${m.f.length} triangles, ${m.v.length} vertices.\n` +
		`export const ${name} = {\n\tv: [\n${vs}\n\t],\n\tf: [\n${fs}\n\t],\n};\n`;
	writeFileSync(resolve(OUT, `${name}.ts`), body);
	console.log(`${name.padEnd(9)} ${String(m.f.length).padStart(4)} tris  ${String(m.v.length).padStart(4)} verts`);
}

// ---- palette ------------------------------------------------------------------------------
// Theme-tinted faces (-1 / -2) are gone. They existed so the pedestal and a couple of trim faces
// picked up the landscape palette, but with eight themed grounds a synthoid that changes colour
// with the terrain reads as part of the scenery — and the one thing a player must never lose
// track of is which shapes are ALIVE. The cast keeps a fixed identity instead.
const C = {
	bark: 0x4a3524, barkLit: 0x5d4430,
	needle: 0x1d5a2a, needleLit: 0x2c7d3a, needleDark: 0x12401d,
	stone: 0x6f7378, stoneLit: 0x878b90, stoneDark: 0x54585c,
	plinth: 0x2b2f36, plinthLit: 0x3a3f47, gold: 0xc8a22a, goldLit: 0xe8c451,
	shell: 0xb03030, shellLit: 0xd04a44, shellDark: 0x7a1e1e,
	// Pale front, dark back — the contrast the reference photograph is built on.
	/*
	 The pale front is a warm RED CLAY, not the reference bird's beige. Faithfulness loses to
	 legibility here: red is the Sentinel's family badge, shared with the sentry and the Meanie's
	 cap, and a beige body read closer to the neutral synthoid than to its own kin at the distance
	 these are actually seen. The pale/dark contrast is what the photograph teaches; the hue stays
	 the game's.
	*/
	// Pushed further off brown: green and blue pulled down hard, since under the scene's white
	// ambient a mid-tone with much green in it reads as terracotta however red its hex looks.
	breast: 0xc32a1c, breastLit: 0xe03c26, breastDark: 0x8e1b10,
	mantle: 0x5c0a0a, mantleLit: 0x7d1212,
	// Cool for the body you inhabit, warm for everything that wants you gone. The player can be
	// looking at a synthoid and a sentry across a valley at the same moment and has to tell them
	// apart instantly; hue does that at a distance where silhouette does not.
	hull: 0x2f6f88, hullLit: 0x3f8ea8, hullDark: 0x1f4c5e,
	dark: 0x14161a, darkLit: 0x22262c,
	visor: 0xffd23c, visorDim: 0xc79a10,
	steel: 0x7c8894, steelLit: 0x9aa6b2, steelDark: 0x5a6672,
	cyan: 0x36d8d0, ember: 0xff7a1a, emberDim: 0xc25200,
	// The original's beak was 0xf0f000 — a hard, bright yellow, and the loudest thing on the model.
	beak: 0xe8d21c, beakLit: 0xfff04a, beakDark: 0xa89406,
	throat: 0x0d0e11, wing: 0x8e2626, wingLit: 0xa93434, wingDark: 0x5e1616,
};

// ---- tree ---------------------------------------------------------------------------------
// Stays a pine: the cone is functional, not decorative — a player reads tree-shaped as "one
// energy, and it hides nothing". Three stacked tiers instead of one smooth cone give it some
// craft without touching the silhouette that matters.
function tree() {
	const m = Model(), H = 1.8125;
	const foot = m.ring(8, 0.16, 0), top = m.ring(8, 0.10, 0.34);
	m.skirt(foot, top, C.bark, C.barkLit);
	m.cap(foot, C.bark, false);
	const tiers = [[0.30, 0.4063, 0.72], [0.62, 0.3200, 1.16], [1.02, 0.2200, 1.56]];
	for (const [base, r, tip] of tiers) {
		const low = m.ring(8, r, base), mid = m.ring(8, r * 0.62, base + (tip - base) * 0.45);
		m.skirt(low, mid, C.needle, C.needleLit);
		m.cap(low, C.needleDark, false);
		const apex = m.vert(0, tip, 0);
		for (let i = 0; i < 8; i++) m.tri(mid[i], mid[(i + 1) % 8], apex, i % 2 ? C.needle : C.needleLit);
	}
	const crown = m.ring(8, 0.16, 1.42), apex = m.vert(0, H, 0);
	for (let i = 0; i < 8; i++) m.tri(crown[i], crown[(i + 1) % 8], apex, i % 2 ? C.needleLit : C.needle);
	return m;
}

// ---- boulder ------------------------------------------------------------------------------
// A cut grey block, as asked. TOP FACE AT EXACTLY y=0.5: engine/scene.ts's BOULDER_RISE says a
// boulder raises the surface by half a unit, and game/botGeometry.ts repeats the number, so a
// block of any other height would put every stacked object visibly off its own footing.
function boulder() {
	const m = Model(), TOP = 0.5;
	// Square rings, not octagonal: "grey block" was the brief, and a chamfered cube reads as cut
	// stone where a dome reads as a pebble. The chamfer is what keeps it from being a plain box.
	const foot = m.ring(4, 0.5000, 0, 0.5);
	const lower = m.ring(4, 0.5800, 0.09, 0.5);
	const upper = m.ring(4, 0.5500, TOP - 0.08, 0.5);
	const top = m.ring(4, 0.4600, TOP, 0.5);
	m.skirt(foot, lower, C.stoneDark, C.stone);
	m.skirt(lower, upper, C.stone, C.stoneLit);
	m.skirt(upper, top, C.stoneLit, C.stone);
	m.cap(top, C.stoneLit);
	m.cap(foot, C.stoneDark, false);
	return m;
}

// ---- pedestal -----------------------------------------------------------------------------
// TOP AT EXACTLY y=1.0 and flat across the middle: PEDESTAL_RISE, and the surface
// canTargetTopObject queries at yOffset 1 for the Sentinel and for the synthoid that wins.
function pedestal() {
	const m = Model(), TOP = 1.0, HW = 0.5;
	/*
	 THE SIDE PLANES NEVER MOVE OFF ±HW. Not at the plinth, not at the reveal, not at the cap.

	 This is the third attempt and the first two both failed the same way for different reasons: a
	 taper, then a full-width profile with a 0.03 inset over the shaft. Both looked fine and both
	 were wrong in play, because the occluder is the original 1x1 block and ANY inset shows you a
	 tile past the pedestal that the crosshair then refuses, with nothing on screen to explain it.
	 Three hundredths of a unit is enough to be maddening.

	 So the original's construction is copied exactly: a square prism whose four faces sit flat at
	 x=±0.5 and z=±0.5 for the whole height, with only the CORNERS chamfered, and the chamfer
	 widening toward the top. Every bit of decoration here is colour or corner, never width.
	*/
	const rings = [
		[0.00, 0.480, C.plinth,    C.plinthLit],   // base: all but a full square
		[0.10, 0.430, C.plinthLit, C.plinth],
		[0.16, 0.400, C.plinth,    C.plinthLit],   // reveal — a corner step, not an inset
		[0.80, 0.330, C.plinthLit, C.plinth],      // shaft, chamfer opening with height
		[0.86, 0.310, C.gold,      C.goldLit],     // gold course
		[0.93, 0.300, C.goldLit,   C.gold],
		[TOP,  0.290, C.plinthLit, C.plinth],
	];
	const built = rings.map(([y, c]) => m.squareRing(HW, c, y));
	m.cap(built[0], C.dark, false);
	for (let i = 0; i < built.length - 1; i++) m.skirt(built[i], built[i + 1], rings[i][2], rings[i][3]);
	// The corner chamfers leave a triangular gap at every step; the cap closes the top flat at
	// exactly PEDESTAL_RISE, which is the surface canTargetTopObject queries at yOffset 1.
	m.cap(built[built.length - 1], C.plinthLit);
	return m;
}

// ---- synthoid -----------------------------------------------------------------------------
// Humanoid, and deliberately legless: the player never walks, they transfer. A figure that ends
// in a plinth says "this thing is placed, not standing", which is exactly the game's verb.
function synthoid() {
	const m = Model(), H = 0.9375;
	const foot = m.ring(8, 0.2000, 0), skirtTop = m.ring(8, 0.1500, 0.30);
	m.skirt(foot, skirtTop, C.hullDark, C.hull);
	m.cap(foot, C.dark, false);
	const waist = m.ring(8, 0.1400, 0.32), chest = m.ring(8, 0.1850, 0.62);
	m.skirt(skirtTop, waist, C.dark, C.darkLit);
	m.skirt(waist, chest, C.hull, C.hullLit);
	const shoulder = m.ring(8, 0.1700, 0.70);
	m.skirt(chest, shoulder, C.hullDark, C.hull);
	for (const side of [-1, 1]) {
		m.box(side * 0.2150, 0.56, 0, 0.0450, 0.1400, 0.0450, C.hullDark, C.hull);
		m.box(side * 0.2150, 0.40, 0.01, 0.0380, 0.0700, 0.0380, C.dark, C.darkLit);
	}
	const neck = m.ring(8, 0.0800, 0.72), jaw = m.ring(8, 0.1300, 0.78);
	m.skirt(shoulder, neck, C.dark);
	m.skirt(neck, jaw, C.darkLit, C.dark);
	const brow = m.ring(8, 0.1350, H - 0.06), crown = m.ring(8, 0.0900, H);
	m.skirt(jaw, brow, C.hull, C.hullLit);
	m.skirt(brow, crown, C.hullLit, C.hull);
	m.cap(crown, C.hullLit);
	// Visor: the one bright thing on the model, and the reason it stays legible at distance.
	m.box(0, 0.845, 0.1150, 0.0850, 0.0250, 0.0350, C.cyan, C.hullLit);
	return m;
}

// ---- sentry -------------------------------------------------------------------------------
// The Sentinel's lesser cousin: same cowled language, narrower, colder, and mounted rather than
// robed — it is machinery doing the same job with less presence.
/*
 The sentry IS the Sentinel's bird, scaled down — which is what it should be, and is now literally
 true rather than a family resemblance hand-built twice.

 Height is the original sentry's 0.9375. Girth is NOT scaled with it: a uniform shrink would take
 the body to 0.385 wide against the sentry occluder's 0.422 and hand back the see-past-but-cannot-
 target problem. 0.90 lands at 0.436 — a shade wider than the occluder, which is the safe side —
 and on almost exactly the original sentry's proportions (0.9375 x 0.422).

 No hood: that is the Sentinel's alone.
*/
function sentry() {
	return buteo({ height: 0.9375, girth: 0.90, hood: false });
}

function sentinelTall(H = 1.62) {
	// (a) Same figure as the first redraw, simply taller. The cheapest test of whether height alone
	// answers "the Sentinel feels too small". Kept for comparison; not the current default.
	const m = Model(), s = H / 1.1797;
	const hem = m.ring(8, 0.2460, 0), robe0 = m.ring(8, 0.2350, 0.30 * s), robe1 = m.ring(8, 0.1950, 0.66 * s);
	m.skirt(hem, robe0, C.shellDark, C.shell);
	m.skirt(robe0, robe1, C.shell, C.shellLit);
	m.cap(hem, C.dark, false);
	const chest = m.ring(8, 0.2150, 0.86 * s);
	m.skirt(robe1, chest, C.shell, C.shellLit);
	const mantle = m.ring(8, 0.2600, 0.90 * s), mantleTop = m.ring(8, 0.1750, 0.98 * s);
	m.skirt(chest, mantle, C.dark, C.darkLit);
	m.skirt(mantle, mantleTop, C.gold, C.goldLit);
	const hoodLow = m.ring(8, 0.1700, 1.00 * s), hoodMid = m.ring(8, 0.1650, H - 0.05 * s);
	m.skirt(mantleTop, hoodLow, C.dark);
	m.skirt(hoodLow, hoodMid, C.shellDark, C.shell);
	const crown = m.ring(8, 0.0850, H);
	m.skirt(hoodMid, crown, C.shell, C.shellLit);
	m.cap(crown, C.shellLit);
	m.box(0, 1.075 * s, 0.1500, 0.1000, 0.0450, 0.0300, C.dark, C.dark);
	m.box(0, 1.078 * s, 0.1720, 0.0750, 0.0130, 0.0180, C.visor, C.ember);
	return m;
}

function sentinelMonument() {
	/*
	 (b) Monumental: heavy rooted hem, a long unbroken taper, and a SMALL head carried high — statue
	 logic, where a small head against a large mass reads as monumental. Kept for comparison; it
	 solved the scale problem but generalised the model further toward "robed figure", which is the
	 opposite of the raptor the originals were.
	*/
	const m = Model(), H = 1.66;
	const hem = m.ring(8, 0.3700, 0);
	const robe0 = m.ring(8, 0.3450, 0.22);
	const robe1 = m.ring(8, 0.2750, 0.72);
	const robe2 = m.ring(8, 0.2050, 1.16);
	m.skirt(hem, robe0, C.shellDark, C.shell);
	m.skirt(robe0, robe1, C.shell, C.shellLit);
	m.skirt(robe1, robe2, C.shellLit, C.shell);
	m.cap(hem, C.dark, false);
	const mantle = m.ring(8, 0.2350, 1.22), mantleTop = m.ring(8, 0.1450, 1.32);
	m.skirt(robe2, mantle, C.dark, C.darkLit);
	m.skirt(mantle, mantleTop, C.gold, C.goldLit);
	const hoodLow = m.ring(8, 0.1350, 1.36), hoodMid = m.ring(8, 0.1300, H - 0.07);
	m.skirt(mantleTop, hoodLow, C.dark);
	m.skirt(hoodLow, hoodMid, C.shellDark, C.shell);
	const crown = m.ring(8, 0.0620, H);
	m.skirt(hoodMid, crown, C.shell, C.shellLit);
	m.cap(crown, C.shellLit);
	m.box(0, 1.452, 0.1180, 0.0790, 0.0400, 0.0260, C.dark, C.dark);
	m.box(0, 1.448, 0.1360, 0.0560, 0.0110, 0.0150, C.visor, C.ember);
	return m;
}

function sentinelObelisk() {
	// (c) Tall, narrow and austere — menace from restraint. Kept for comparison; narrower than the
	// occluder, which risks the see-past-but-cannot-target problem the pedestal had.
	const m = Model(), H = 1.78;
	const foot = m.ring(8, 0.2600, 0);
	const shaft0 = m.ring(8, 0.2000, 0.12);
	const shaft1 = m.ring(8, 0.1600, 1.28);
	m.skirt(foot, shaft0, C.dark, C.darkLit);
	m.skirt(shaft0, shaft1, C.shell, C.shellDark);
	m.cap(foot, C.dark, false);
	const collar = m.ring(8, 0.1900, 1.34), collarTop = m.ring(8, 0.1550, 1.42);
	m.skirt(shaft1, collar, C.gold, C.goldLit);
	m.skirt(collar, collarTop, C.dark, C.darkLit);
	const hood = m.ring(8, 0.1500, H - 0.14), crown = m.ring(8, 0.0700, H);
	m.skirt(collarTop, hood, C.shellDark, C.shell);
	m.skirt(hood, crown, C.shell, C.shellLit);
	m.cap(crown, C.shellLit);
	m.box(0, 1.545, 0.1150, 0.0880, 0.0520, 0.0420, C.dark, C.dark);
	m.box(0, 1.532, 0.1420, 0.0520, 0.0100, 0.0150, C.visor, C.ember);
	return m;
}

/*
 (d) RAPTOR — the direction the originals were already pointing in.

 The old Sentinel and Sentry read as birds of prey on a perch. The frozen models carry face labels
 like `beak top`, `beak front` and `below beak`, but those were written by hand during
 transcription and so record how the shape read to the person transcribing it, not what the 1986
 author meant — they are the hunch, not evidence for it.

 The geometry is the evidence, and it is independent of the naming: that wedge is 0xf0f000, a hard
 bright yellow and the loudest thing on the model, and it juts to z=0.242 while the head's own
 front stops at 0.098 — a third of its length proud of the face, over a black throat. The head is
 also the WIDEST part of the whole model at ±0.246, carried on a narrower body. Whatever it was
 called, that is a beak on a raptor's skull.

 The redraw had inverted both of those. The beak became a small ember visor slit, and the head
 became the SMALLEST element because statue logic says a small head reads as monumental. True for
 a statue, wrong for a raptor: a hawk's menace is a heavy head and a hooked beak on a slight body.

 So this restores the anatomy and keeps the height that fixed the scale problem: talons gripping
 the perch, a narrow shaft, folded wings swept down the back, a heavy brow, and a hooked yellow
 beak thrust forward over a black throat.
*/
function sentinelRaptor(chest = 0.205) {
	/*
	 NO POLE. The body reaches the ground.

	 The first raptor stood on a dark leg running from 0.09 to 0.44 — 28% of the model's height
	 spent on a stick, with the bird itself confined to the top half. It read exactly as that: a
	 small bird on a pole, no taller than the synthoid despite being half again its height.

	 The original does the opposite and is worth copying: a foot of 0.125, then BODY from there to
	 0.914 — two thirds of the whole model — with the head above it. A perched raptor's legs are
	 hidden behind belly feathers anyway, so the silhouette is body all the way down to the talons.

	 `chest` is the half-width at the widest point, and it is the tuning knob for how much presence
	 the thing has versus how gaunt it looks.
	*/
	const m = Model(), H = 1.58;

	// Talons at ground level, splayed on the diagonals and gripping.
	for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
		const a = m.vert(sx * 0.070, 0.095, sz * 0.070);
		const b = m.vert(sx * 0.170, 0.075, sz * 0.170);
		const c = m.vert(sx * 0.295, 0.000, sz * 0.275);
		const d = m.vert(sx * 0.110, 0.000, sz * 0.110);
		m.quad(a, b, c, d, C.dark);
		m.quad(d, c, b, a, C.darkLit);
	}

	// Body: ankle to shoulder in one unbroken run, widest at the breast.
	const ankle = m.ring(8, chest * 0.52, 0.06);
	const hips = m.ring(8, chest * 0.86, 0.34);
	const breast = m.ring(8, chest, 0.74);
	const upper = m.ring(8, chest * 0.90, 1.02);
	m.skirt(ankle, hips, C.wingDark, C.shellDark);
	m.skirt(hips, breast, C.shell, C.shellLit);
	m.skirt(breast, upper, C.shellLit, C.shell);
	m.cap(ankle, C.dark, false);

	/*
	 Wings folded the length of the body, and shoulder peaks ABOVE the neck so the head sits down
	 between them. The hunch is most of where the menace comes from; hanging the wings below the
	 neck line, as the first pass did, leaves the bird standing upright and mild.
	*/
	const neck = m.ring(8, chest * 0.50, 1.09);
	m.skirt(upper, neck, C.throat);
	for (const sx of [-1, 1]) {
		const p0 = m.vert(sx * (chest * 0.66), 1.20, -0.020);
		const p1 = m.vert(sx * (chest + 0.100), 1.00, -0.080);
		const p2 = m.vert(sx * (chest + 0.045), 0.34, -0.010);
		const p3 = m.vert(sx * (chest * 0.62), 0.40, 0.075);
		const p4 = m.vert(sx * (chest * 0.68), 1.06, 0.065);
		m.quad(p0, p1, p2, p3, C.wing);
		m.tri(p0, p3, p4, C.wingLit);
		m.tri(p4, p3, p0, C.wingDark);
		const q0 = m.vert(sx * (chest * 0.66), 1.19, 0.010);
		const q1 = m.vert(sx * (chest + 0.075), 1.01, -0.020);
		const q2 = m.vert(sx * (chest + 0.010), 0.58, 0.070);
		m.tri(q0, q1, q2, C.wingLit);
		m.tri(q2, q1, q0, C.wing);
	}

	// Head, deliberately wider than the neck under it.
	const jaw = m.ring(8, 0.1900, 1.17), skull = m.ring(8, 0.2050, 1.38), crown = m.ring(8, 0.1000, H);
	m.skirt(neck, jaw, C.shellDark, C.shell);
	m.skirt(jaw, skull, C.shell, C.shellLit);
	m.skirt(skull, crown, C.shellLit, C.shell);
	m.cap(crown, C.shellLit);

	/*
	 The brow, and the eyes UNDER it. A flat dark bar reads as sunglasses; what makes a hawk's stare
	 is a ridge that juts forward and drops at the outer corners, with the eye set back in the
	 shadow it casts.
	*/
	m.box(0, 1.392, 0.1600, 0.1050, 0.0300, 0.0740, C.throat, C.dark);
	for (const sx of [-1, 1]) {
		const e0 = m.vert(sx * 0.1000, 1.422, 0.1050);
		const e1 = m.vert(sx * 0.2000, 1.372, 0.0150);
		const e2 = m.vert(sx * 0.1750, 1.300, 0.0450);
		const e3 = m.vert(sx * 0.0950, 1.352, 0.1550);
		m.quad(e0, e1, e2, e3, C.throat);
		m.quad(e3, e2, e1, e0, C.dark);
		// z=0.170: the skull's front facet sits at z~0.152 at this x, so anything shallower ends up
		// inside the head. These are the only warm thing on the face and have to stand proud of it.
		m.box(sx * 0.1140, 1.318, 0.1700, 0.0360, 0.0290, 0.0330, C.ember, C.emberDim);
	}
	m.box(0, 1.190, 0.1350, 0.0980, 0.0720, 0.0560, C.throat, C.throat);

	// Beak: culmen dropping in two segments to a point that IS the hook. Length is settled; the
	// user judged it right at this size, so only the body around it changes.
	const bl = m.vert(-0.0700, 1.348, 0.1400), br = m.vert(0.0700, 1.348, 0.1400);
	const gl = m.vert(-0.0700, 1.206, 0.1400), gr = m.vert(0.0700, 1.206, 0.1400);
	const ml = m.vert(-0.0420, 1.318, 0.2850), mr = m.vert(0.0420, 1.318, 0.2850);
	const nl = m.vert(-0.0420, 1.196, 0.2750), nr = m.vert(0.0420, 1.196, 0.2750);
	const tip = m.vert(0, 1.108, 0.3720);
	m.quad(bl, br, mr, ml, C.beakLit);
	m.tri(ml, mr, tip, C.beakLit);
	m.quad(bl, ml, nl, gl, C.beak);
	m.quad(br, gr, nr, mr, C.beak);
	m.tri(ml, tip, nl, C.beak);
	m.tri(mr, nr, tip, C.beak);
	m.quad(gl, nl, nr, gr, C.beakDark);
	m.tri(nl, tip, nr, C.beakDark);
	return m;
}

/*
 (d) HAWK — built against a photograph of a perched buteo rather than from memory.

 What the reference settles, measured off it rather than guessed:

   - The head is SMALL. Roughly half the chest's width and about a sixth of the standing height.
     Variant (c) had a skull 137% of its own chest and a head filling 31% of the model. A large
     round head on a small body is the textbook neoteny cue — it is what makes a chick, a puppy
     and a plush toy read as endearing — so no amount of beak was ever going to make it menacing.
   - There is NO NECK. The skull sits straight onto the shoulders and the nape slopes back into
     the mantle in one line.
   - The skull is FLATTENED and deeper front-to-back than it is wide, not a ball.
   - The beak is SHORT. It hooks down almost immediately off the face; it does not project. The
     length I had been protecting was never the thing carrying the menace.
   - The eye is LARGE against that small head, set forward and high, right behind the beak.
   - Pale streaked breast against dark folded wings, and the wings run the full length of the body
     to a tail below.

 The posture is upright and still rather than hunched — a hawk does not need to crouch to be
 frightening, and the stillness is most of it.
*/
function sentinelHawk() {
	const m = Model(), H = 1.58, chest = 0.150;

	for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
		const a = m.vert(sx * 0.070, 0.095, sz * 0.070);
		const b = m.vert(sx * 0.170, 0.075, sz * 0.170);
		const c = m.vert(sx * 0.295, 0.000, sz * 0.275);
		const d = m.vert(sx * 0.110, 0.000, sz * 0.110);
		m.quad(a, b, c, d, C.dark);
		m.quad(d, c, b, a, C.darkLit);
	}

	// One continuous body, ankle to shoulder, with no waist — pale in front, dark behind.
	const ankle = m.ring(8, chest * 0.50, 0.05);
	const hips = m.ring(8, chest * 0.84, 0.32);
	const belly = m.ring(8, chest, 0.72);
	const shoulder = m.ring(8, chest * 0.90, 1.16);
	m.skirtFB(ankle, hips, C.breastDark, C.mantle);
	m.skirtFB(hips, belly, C.breast, C.mantle);
	m.skirtFB(belly, shoulder, C.breastLit, C.mantleLit);
	m.cap(ankle, C.dark, false);

	// Folded wings the full length of the body, and a tail dropping behind the feet.
	for (const sx of [-1, 1]) {
		const p0 = m.vert(sx * (chest * 0.72), 1.16, -0.030);
		const p1 = m.vert(sx * (chest + 0.055), 0.98, -0.070);
		const p2 = m.vert(sx * (chest + 0.020), 0.30, -0.015);
		const p3 = m.vert(sx * (chest * 0.58), 0.34, 0.060);
		const p4 = m.vert(sx * (chest * 0.74), 1.05, 0.055);
		m.quad(p0, p1, p2, p3, C.mantle);
		m.tri(p0, p3, p4, C.mantleLit);
		m.tri(p4, p3, p0, C.mantle);
	}
	const tl0 = m.vert(-0.085, 0.60, -0.075), tr0 = m.vert(0.085, 0.60, -0.075);
	const tl1 = m.vert(-0.062, 0.10, -0.215), tr1 = m.vert(0.062, 0.10, -0.215);
	m.quad(tl0, tr0, tr1, tl1, C.mantle);
	m.quad(tl1, tr1, tr0, tl0, C.mantleLit);

	/*
	 The head: small, flattened, and set straight on the shoulders. `ring`'s sz scale makes it
	 deeper front-to-back than wide, which is the shape of a real skull and the opposite of the
	 ball that variant (c) carried.
	*/
	const nape = m.ring(8, 0.1050, 1.240, 0, 1, 1.22);
	const skull = m.ring(8, 0.1120, 1.398, 0, 1, 1.25);
	const brow = m.ring(8, 0.1080, 1.492, 0, 1, 1.20);
	const crown = m.ring(8, 0.0650, H, 0, 1, 1.10);
	m.skirtFB(shoulder, nape, C.breastLit, C.mantle);
	m.skirtFB(nape, skull, C.breastLit, C.mantleLit);
	m.skirtFB(skull, brow, C.shellDark, C.mantle);
	m.skirt(brow, crown, C.mantle, C.mantleLit);
	m.cap(crown, C.mantleLit);

	// Supraorbital ridge and a large eye set under it — on this head the eye is the feature, and
	// the beak only finishes the sentence.
	for (const sx of [-1, 1]) {
		const r0 = m.vert(sx * 0.0460, 1.508, 0.1180);
		const r1 = m.vert(sx * 0.1250, 1.480, 0.0340);
		const r2 = m.vert(sx * 0.1140, 1.428, 0.0640);
		const r3 = m.vert(sx * 0.0440, 1.462, 0.1320);
		m.quad(r0, r1, r2, r3, C.throat);
		m.quad(r3, r2, r1, r0, C.dark);
		// z=0.110: the skull facet sits at z~0.103 at this x, so the eye stands just proud of it.
		m.box(sx * 0.0730, 1.436, 0.1100, 0.0330, 0.0300, 0.0250, C.ember, C.emberDim);
	}

	/*
	 A SHORT beak, hooking down off the face almost at once. Variant (c)'s projected 0.23 forward
	 and that length is what made it a bill; here it reaches 0.09 and turns straight down.
	*/
	const cere = m.vert(0, 1.454, 0.1180);
	const bl = m.vert(-0.0380, 1.432, 0.1140), br = m.vert(0.0380, 1.432, 0.1140);
	const ml = m.vert(-0.0290, 1.398, 0.1820), mr = m.vert(0.0290, 1.398, 0.1820);
	const gl = m.vert(-0.0330, 1.348, 0.1090), gr = m.vert(0.0330, 1.348, 0.1090);
	const tip = m.vert(0, 1.310, 0.1650);
	m.tri(cere, br, bl, C.beakLit);
	m.quad(bl, br, mr, ml, C.beakLit);
	m.tri(ml, mr, tip, C.beak);
	m.quad(bl, ml, tip, gl, C.beak);
	m.quad(br, gr, tip, mr, C.beak);
	m.tri(gl, tip, gr, C.beakDark);
	m.tri(bl, gl, gr, C.throat);
	return m;
}

/*
 (e) BUTEO — started from scratch against the reference photograph rather than adapted from the
 earlier birds, which is what was asked for and was the right call: every previous pass inherited
 the same wrong armature and only redecorated it.

 The shape is driven by a SIDE PROFILE table, because that is what a perched buteo actually is:

   - A leaning teardrop. The breast is full and pushed FORWARD while the back runs as a nearly
     straight line from crown to tail. Concentric rings cannot express that, which is why ringOff
     exists — each ring's centre slides forward as it rises, and the mass ends up over the feet
     rather than stacked on the axis.
   - Widest at the upper chest, tapering down through the belly, not a cylinder.
   - No neck at all: the crown-to-tail line is unbroken, and the head is simply where the body
     stops narrowing.
   - The head is small and sits FORWARD of the back line, with a rounded crown falling away to the
     face.
   - The tail is a long straight wedge continuing down BEHIND the feet, roughly half the body's
     length. It is a big part of the silhouette and every earlier version omitted it.
   - Legs are almost entirely hidden under belly feathers. Only a short tarsus and the foot show.

 Deliberately NOT here, both reported as breaking the illusion:
   - The four claws splayed around the body. A bird has two feet, each with three toes forward and
     one back, gripping in front of it — not a tripod skirt.
   - The bright eye over a black brow ridge. In the photograph the eye is DARK in a pale face; the
     inverted version read as Angry Birds. A watcher probably wants some glow eventually, but it
     has to be earned by the shape first.
*/
/*
 Height and girth, both tunable. The body is laid out at whatever size is convenient and fitted to
 SENTINEL_H at the end (see fitHeight), so the proportions settled above survive any size change.

 SENTINEL_H defaults to 1.1797 — the ORIGINAL Sentinel's height, and therefore the occluder's. The
 model was drawn taller while the silhouette was being worked out, which was useful then and is not
 needed now that the shape carries itself.

 If you change SENTINEL_H, change OCCLUDER_Y_SCALE in src/world/objects/models/index.ts to match:
 the occluder must not fall short of the drawn head, or its top stops answering the crosshair.
 GIRTH multiplies x and z only; keep the drawn model at least as wide as the occluder's 0.492, or
 you get tiles that are visible past the model and refused by the rules.
*/
const SENTINEL_H = Number(process.env.SENTINEL_H ?? 1.1797);
const GIRTH = Number(process.env.SENTINEL_W ?? 1.0);

function buteo({ height, girth = 1, hood = false }) {
	const m = Model(), H = 1.58;   // laid out against this; scaled to `height` at the end

	/*
	 [y, half-width, half-depth, z of centre].

	 THE BODY REACHES THE GROUND LIKE A ROBE. No tail, no feet, no visible legs — which is what the
	 original did, and keeping it is worth more than anatomical honesty: a bird standing on twig legs
	 is an animal, while a column that happens to have a raptor's head and shoulders is a presence.
	 It also removes the two things reported as breaking the illusion in one stroke.

	 The breast is deliberately SLIMMER than the reference's. A real perched buteo is fluffed, and
	 copying that read as plump rather than dangerous; drawing the chest in gives the silhouette a
	 vertical line to fall down and buys back the majesty. Widest point sits at ~60% of height with
	 its centre 0.06 forward of the hem's axis, so the mass still leans over you.
	*/
	const PROFILE = [
		[0.000, 0.200, 0.226, -0.012],   // hem, on the ground
		[0.150, 0.196, 0.222,  0.000],
		[0.420, 0.206, 0.238,  0.024],
		[0.690, 0.216, 0.252,  0.048],
		[0.930, 0.222, 0.258,  0.062],   // breast — the fullest point, but no longer fluffed
		[1.120, 0.206, 0.240,  0.052],
		[1.270, 0.160, 0.186,  0.020],   // shoulders; the body simply stops widening here
		[1.360, 0.114, 0.130,  0.038],   // head, forward of the back line
		[1.460, 0.118, 0.134,  0.056],
		[1.545, 0.068, 0.078,  0.048],   // crown, falling away to the face
	];
	const rings = PROFILE.map(([y, rx, rz, z]) => m.ringOff(8, rx, rz, y, z));
	/*
	 ONE colour front, one back, and only the hem darkened.

	 This was a table alternating two tones per ring, which painted five horizontal stripes up the
	 body — obvious on the back, muted on the front. It was there all along and hid while the
	 palette was brown, because mantle and mantleLit were close together; reddening the model widened
	 the gap and the banding surfaced. Alternation is fine for a skirt of a few facets (it reads as
	 faceting) and wrong for a lofted body of ten rings, where it reads as a pattern.

	 The form is already described by flat shading across the profile and by the detail texture, so
	 the colour only has to carry the pale-front / dark-back contrast.
	*/
	for (let i = 0; i < rings.length - 1; i++) {
		const front = i === 0 ? C.breastDark : C.breast;   // hem sits in its own shadow
		m.skirtFB(rings[i], rings[i + 1], front, C.mantle);
	}
	m.cap(rings[rings.length - 1], C.mantleLit);
	m.cap(rings[0], C.mantle, false);

	/*
	 Folded wings: the leading edge runs from the shoulder down the flank and the tip crosses low,
	 near the tail base. Drawn as plates just outside the body so they read as a separate dark mass
	 over the pale breast rather than as paint on it.
	*/
	for (const sx of [-1, 1]) {
		const w0 = m.vert(sx * 0.142, 1.258, 0.000);
		const w1 = m.vert(sx * 0.242, 1.090, -0.055);
		const w2 = m.vert(sx * 0.206, 0.340, -0.060);
		const w3 = m.vert(sx * 0.128, 0.300, 0.075);
		const w4 = m.vert(sx * 0.152, 1.140, 0.108);
		m.quad(w0, w1, w2, w3, C.mantle);
		m.tri(w0, w3, w4, C.mantleLit);
		m.tri(w4, w3, w0, C.mantle);
	}

	/*
	 The head.

	 The eyes are drawn ON the skull's own surface rather than as boxes stuck to the front of it. A
	 protruding eye is a cartoon eye — it was the last thing making this read as a character rather
	 than a creature — so `skin` re-evaluates the head profile at any height and angle, and the eye
	 is a patch lying 2% outside that surface: enough to render cleanly over it, not enough to be a
	 bump. The dark eyeline sweeping back from it is drawn the same way, so the two sit flush with
	 each other and with the head.
	*/
	const skin = (y, ang, out = 1) => {
		const t = (y - 1.360) / 0.100;                       // between the two head rings above
		const rx = (0.114 + 0.004 * t) * out;
		const rz = (0.130 + 0.004 * t) * out;
		const z0 = 0.038 + 0.018 * t;
		return m.vert(Math.sin(ang) * rx, y, Math.cos(ang) * rz + z0);
	};
	for (const sx of [-1, 1]) {
		const O = 1.02;
		// Eye: a small dark patch on the face, high and forward, just behind the beak.
		const e0 = skin(1.478, sx * 0.30, O), e1 = skin(1.478, sx * 0.86, O);
		const e2 = skin(1.428, sx * 0.86, O), e3 = skin(1.428, sx * 0.30, O);
		m.quad(e0, e1, e2, e3, C.throat);
		m.quad(e3, e2, e1, e0, C.throat);
		// Eyeline: continues from the eye round the side of the head, as on the reference bird.
		const l0 = skin(1.474, sx * 0.88, O), l1 = skin(1.462, sx * 1.55, O);
		const l2 = skin(1.412, sx * 1.55, O), l3 = skin(1.424, sx * 0.88, O);
		m.quad(l0, l1, l2, l3, C.mantle);
		m.quad(l3, l2, l1, l0, C.mantle);
	}

	/*
	 A PROMINENT beak. The reference's is modest, but this one has to carry the model's whole
	 character at the distance the Sentinel is usually seen — on a pedestal, across a valley — and
	 the previous version's 0.05 of projection simply vanished there. This reaches 0.14 forward and
	 a third of the head's depth, with the culmen dropping the whole way to a hooked point.
	*/
	const cere = m.vert(0, 1.486, 0.150);
	const bl = m.vert(-0.048, 1.462, 0.148), br = m.vert(0.048, 1.462, 0.148);
	const ml = m.vert(-0.034, 1.424, 0.244), mr = m.vert(0.034, 1.424, 0.244);
	const gl = m.vert(-0.042, 1.356, 0.144), gr = m.vert(0.042, 1.356, 0.144);
	const nl = m.vert(-0.024, 1.372, 0.246), nr = m.vert(0.024, 1.372, 0.246);
	const tip = m.vert(0, 1.318, 0.288);
	m.tri(cere, br, bl, C.beakDark);
	m.quad(bl, br, mr, ml, C.beakDark);                  // culmen
	m.tri(ml, mr, tip, C.beak);                          // culmen dropping to the point
	m.quad(bl, ml, nl, gl, C.beakDark);                  // left cheek
	m.quad(br, gr, nr, mr, C.beakDark);                  // right cheek
	m.tri(ml, tip, nl, C.beak);
	m.tri(mr, nr, tip, C.beak);
	m.quad(gl, nl, nr, gr, C.throat);                    // underside, in shadow
	m.tri(nl, tip, nr, C.throat);

	/*
	 THE HOOD — what separates the Sentinel from its sentries.

	 A cowl rising off the shoulders, covering the back and sides of the skull and drawn forward
	 into a drooping point above the face. The head is left visible only through the gap it leaves,
	 so the beak emerges from shadow rather than from a shape you can read at a glance. That
	 concealment is the whole idea: a sentry is a bird, and the Sentinel is a bird you cannot quite
	 see all of.

	 Built from OPEN arcs (arcOff/skirtOpen) rather than rings, because a cowl is a shell with a
	 mouth. The arcs run from A0 round the back to -A0, leaving the face open between them.
	*/
	if (hood) {
		/*
		 A cowl has THICKNESS and a mouth. The first attempt lofted a single open shell and closed
		 its cut edges with a fan to a point, which produced a flat brim with junk geometry inside
		 it — it read as a squashed hat. This builds an outer skin and an inner lining and joins
		 them at the rim, so the opening is a real edge you can see the depth of, and the inside is
		 in shadow.

		 It is also TALLER and leans forward: the peak stands well above the crown and each layer
		 shifts forward as it rises, so from below the hood overhangs the face.
		*/
		const A0 = 0.86;                       // half-angle of the opening, radians from front
		const N = 8;
		const LINING = 0.84;
		/*
		 The peak sits just clear of the crown, and no higher.

		 It was originally 0.30 above the head, which from the front at eye level opened a black
		 cavity inside the cowl with nothing to explain it — a hood is cloth over a skull, and the
		 gap has to read as drape, not as an empty room. The head tops out at 1.545, so the peak is
		 now 0.115 clear of it: enough to hang, not enough to be a void. Every other angle liked the
		 taller version, so only the top two layers moved.
		*/
		const layers = [
			// [y, rx, rz, zOff]
			[1.150, 0.232, 0.262, 0.006],      // draping onto the shoulders
			[1.340, 0.214, 0.242, 0.030],
			[1.490, 0.186, 0.210, 0.052],
			[1.595, 0.132, 0.148, 0.064],
			[1.660, 0.048, 0.054, 0.060],      // peak, just clear of the crown
		];
		const outer = layers.map(([y, rx, rz, z]) => m.arcOff(N, rx, rz, y, z, A0, 2 * Math.PI - A0));
		const inner = layers.map(([y, rx, rz, z]) =>
			m.arcOff(N, rx * LINING, rz * LINING, y, z, A0, 2 * Math.PI - A0));
		for (let i = 0; i < layers.length - 1; i++) {
			m.skirtOpen(outer[i], outer[i + 1], C.mantle, C.mantleLit);
			m.skirtOpen(inner[i + 1], inner[i], C.throat);          // reversed: seen from inside
		}
		// Peak: close the gap between skin and lining, then cap it.
		m.skirtOpen(outer[4], inner[4], C.mantleLit);
		for (let i = 1; i < N; i++) m.tri(outer[4][0], outer[4][i], outer[4][i + 1], C.mantleLit);
		// Rim: the mouth of the cowl, both cut edges, and the hem at the bottom.
		for (const end of [0, N]) {
			for (let i = 0; i < layers.length - 1; i++) {
				m.quad(outer[i][end], outer[i + 1][end], inner[i + 1][end], inner[i][end], C.mantleLit);
			}
		}
		m.skirtOpen(inner[0], outer[0], C.mantle);
	}

	/*
	 Girth and height are applied SEPARATELY and on purpose. A uniform shrink would take the body to
	 0.36 wide against the occluder's 0.492 and reintroduce the see-past-but-cannot-target problem;
	 leaving the width alone also lands almost exactly on the ORIGINAL Sentinel's proportions
	 (1.18 x 0.49). fitHeight measures the built model rather than trusting a nominal design size,
	 so the hooded and bare birds each land exactly on their own target.
	*/
	m.scaleAll(girth, 1, girth);
	m.fitHeight(height);
	return m;
}

// Chest half-width options, shown side by side so the trade between presence and gauntness can be
// judged rather than argued: RAPTOR_CHEST=wide|mid|narrow|gaunt.
const CHESTS = { wide: 0.205, mid: 0.175, narrow: 0.150, gaunt: 0.128 };
const chestWidth = CHESTS[process.env.RAPTOR_CHEST ?? 'narrow'] ?? CHESTS.narrow;

// (c) is the narrow perched raptor the user asked to keep; (d) is the hawk built from the
// reference photo. (o) is the obelisk, retired but not deleted.
/*
 ---- THE ROBOTIC FAMILY -----------------------------------------------------------------------

 The watchers as they were drawn before the bird direction: a robed, cowled machine with a lit
 visor, and a lesser version of it mounted on a steel column. Kept and shipped alongside the birds
 rather than discarded, because both read well and they are genuinely different games to look at —
 one is a creature watching you, the other is a lighthouse that has noticed you.

 Selected at runtime by settings.modelFamily; see src/engine/scene.ts.
*/
function sentinelRobot() {
	// The first redraw's figure at the ORIGINAL height — sentinelTall(a) is this shape stretched,
	// so building it here at 1.1797 keeps the two from drifting apart as separate copies.
	return sentinelTall(1.1797);
}

function sentryRobot() {
	const m = Model(), H = 0.9375;
	/*
	 Red, like the Sentinel and the Meanie's cap. The sentry is the Sentinel's lesser cousin and the
	 player has to read that instantly from across a valley; grey put it in the same family as the
	 boulders instead. Steel is kept for the column it stands on, which is what separates it from
	 the Sentinel's robed base.
	*/
	const foot = m.ring(8, 0.2100, 0), col0 = m.ring(8, 0.1100, 0.10), col1 = m.ring(8, 0.0950, 0.40);
	m.skirt(foot, col0, C.dark, C.darkLit);
	m.skirt(col0, col1, C.steelDark, C.steel);
	m.cap(foot, C.dark, false);
	// A collar wider than the head it carries: the overhang is what makes a shape look like it is
	// leaning over you, and it is the trick the sentry shares with the Sentinel.
	const collarLow = m.ring(8, 0.2200, 0.44), collarTop = m.ring(8, 0.1900, 0.56);
	m.skirt(col1, collarLow, C.shellDark);
	m.skirt(collarLow, collarTop, C.shell, C.shellLit);
	const bodyTop = m.ring(8, 0.1750, 0.74);
	m.skirt(collarTop, bodyTop, C.shellDark, C.shell);
	const cowlLow = m.ring(8, 0.2000, 0.78), cowlTop = m.ring(8, 0.0750, H);
	m.skirt(bodyTop, cowlLow, C.dark, C.darkLit);
	m.skirt(cowlLow, cowlTop, C.shell, C.shellLit);
	m.cap(cowlTop, C.shellLit);
	// The visor runs BACK into the cowl rather than sitting on the front of it: at a shallower
	// depth its rear face stopped level with the surface and it read as a bar floating in front of
	// the head rather than something the head is looking through.
	m.box(0, 0.845, 0.0850, 0.0700, 0.0180, 0.1250, C.ember, C.emberDim);
	return m;
}

const SENTINELS = {
	a: sentinelTall, b: sentinelMonument, o: sentinelObelisk,
	c: () => sentinelRaptor(chestWidth), d: sentinelHawk,
	e: () => buteo({ height: SENTINEL_H, girth: GIRTH, hood: true }),
};
const sentinel = SENTINELS[process.env.SENTINEL ?? 'e'] ?? SENTINELS.e;

// ---- meanie -------------------------------------------------------------------------------
// A desk lamp with bad intentions, per the brief: trapezoidal base, a jointed arm, and a weapon
// head at the end of it. Reads as a machine that was pointed at you rather than a creature.
function meanie() {
	const m = Model(), H = 0.9219;
	const base0 = m.ring(4, 0.3100, 0, 0.5), base1 = m.ring(4, 0.2050, 0.16, 0.5);
	m.skirt(base0, base1, C.steelDark, C.steel);
	m.cap(base1, C.steel);
	m.cap(base0, C.dark, false);
	// Lower arm, leaning forward; upper arm leaning back — the classic lamp elbow.
	const j0 = m.ring(6, 0.0560, 0.16), j1 = m.ring(6, 0.0480, 0.50);
	m.skirt(j0, j1, C.steel, C.steelLit);
	const elbow = m.ring(6, 0.0700, 0.54);
	m.skirt(j1, elbow, C.cyan);
	const a0 = m.ring(6, 0.0480, 0.56, 0, 1, 1), a1 = m.ring(6, 0.0430, 0.74, 0, 1, 1);
	m.skirt(elbow, a0, C.steelDark);
	m.skirt(a0, a1, C.steel, C.steelLit);
	// Head: a shade tapering to the muzzle, pointed forward (+Z) like every other model.
	const collar = m.ring(8, 0.0850, 0.76), shade = m.ring(8, 0.1750, H - 0.03);
	m.skirt(a1, collar, C.steelDark);
	m.skirt(collar, shade, C.shell, C.shellLit);
	m.cap(shade, C.shellDark);
	m.box(0, 0.845, 0.1450, 0.0620, 0.0620, 0.0700, C.dark, C.darkLit);
	m.box(0, 0.845, 0.2050, 0.0330, 0.0330, 0.0300, C.ember, C.emberDim);
	return m;
}

/*
 Five models are shared by both families; only the two watchers differ, so only they get a second
 file. `sentinelRobot`/`sentryRobot` are emitted alongside the birds and picked between at runtime
 (settings.modelFamily) rather than at build time, so switching is a menu entry and not a rebuild.
*/
const MODELS = {
	tree, boulder, pedestal, synthoid, meanie,
	sentry, sentinel,                                  // prey birds — the default family
	sentryRobot, sentinelRobot,                        // the robotic family
};
for (const [name, build] of Object.entries(MODELS)) emit(name, build());
