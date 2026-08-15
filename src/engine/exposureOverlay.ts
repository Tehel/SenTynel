/*
 Debug visualisation of the exposure map (game/exposure.ts, PLAN-EXPOSURE.md).

 One small square per flat cell, floating just above the ground, coloured by how long that cell
 stays safe. Built before any planner uses the map, deliberately: every wall found in the bot so
 far was found by watching rather than by measuring, and a map nobody has ever seen is a map
 nobody should trust.

 Debug-gated (Settings -> Display -> Show exposure map), and it stays that way — it is an oracle,
 and a player who can see it is not really playing the game.

 ALL THE TUNING CONSTANTS ARE AT THE TOP, in one block, so the look can be adjusted without
 reading the rest.

 Drawing ONLY. The map itself, and the live watcher clocks it is read against, belong to
 engine/exposureSensor.ts — so a planner can consume exposure without importing a visualisation,
 and switching this off costs the sensor nothing. Everything here takes an ExposureView and paints.

 Costs one draw call: a single InstancedMesh over the flat cells, with per-instance colour. The
 per-frame work is nil — colours are recomputed on the 4 Hz game tick (engine/loop.ts), which is
 the only thing that can change them, and once more whenever the overlay is switched on or the
 scene is rebuilt (ui/MainView.svelte).
*/

import {
	Color,
	DoubleSide,
	InstancedBufferAttribute,
	InstancedMesh,
	Matrix4,
	MeshBasicMaterial,
	PlaneGeometry,
} from 'three';
import type { Disposer } from './disposer';
import type { ExposureView } from './exposureSensor';
import { MAP_SIZE, type Level } from '../world/terrain';

// ---------------------------------------------------------------------------------------------
// Tuning. Everything visual lives here.
// ---------------------------------------------------------------------------------------------

// Square edge length, as a fraction of a cell. Below 1 so the gaps show the grid through.
export const SQUARE_SIZE = 1 / 2;
// How far above the cell's own surface the square floats. Enough to clear z-fighting and to read
// from a low angle; small enough not to look detached from the ground.
export const HOVER_HEIGHT = 0.02;

/*
 The countdown ramp, in 4 Hz ticks. 120 = 30 s.

 Deliberately much shorter than a watcher's full cycle (64 turns x 12 s = 12.8 minutes). Scaled to
 the cycle, almost every cell with line of sight would sit somewhere in the middle of the gradient
 and the picture would say nothing; scaled to a decision, the colour answers "can I finish what I
 am doing here before the cone arrives", which is the question actually being asked. Anything
 further out reads as flatly safe.
*/
export const RAMP_HORIZON_TICKS = 144;

// A watcher can see it right now.
export const COLOR_IN_SIGHT = 0xff2020;
// Half-way along the ramp.
export const COLOR_SOON = 0xff8c00;
// At or beyond RAMP_HORIZON_TICKS, but exposed eventually.
export const COLOR_CLEAR = 0x30c030;
// No watcher has a sightline to this cell at this height, whatever their facing.
export const COLOR_HIDDEN = 0x2050b0;
// The cell stands at or above EVERY live watcher's eye. engine/visibility.ts refuses a target
// level with the eye, so nothing here can ever be drained — a different kind of safe from
// COLOR_HIDDEN, and worth its own colour because it is permanent and earned rather than given.
export const COLOR_ABOVE_EYE = 0xa040e0;

/*
 Diagonal hatching for a cell whose next exposure waits on a HELD turn — a watcher that has stopped
 rotating because it found something to eat (engine/watcher.ts's drainLocked).

 Marking rather than recolouring, and the distinction matters. A held watcher's whole future
 schedule is paused, so every cell it will ever reach is technically "held" — painting them all one
 flag colour is true but throws away the ramp, which is the part worth having: "red once it stops"
 and "green once it stops" are very different places to be standing, and a plan is built out of
 exactly that. So the colour keeps saying WHEN, and the hatching says WHETHER THE CLOCK IS RUNNING.

 The gaps are cut with `discard`, so the ground shows through: that reads as "provisional" at any
 distance and on any theme, and it leaves the painted stripes at full saturation so the ramp stays
 exactly as legible as on a running watcher. Half-opacity was tried first and rejected — on a
 saturated theme it mostly read as "slightly darker".

 Computed in WORLD space, not per square, so adjacent held cells line up into continuous bands
 rather than each square being hatched on its own. That is what makes the region readable at range.

 STRIPE_PERIOD is the diagonal repeat in world units; STRIPE_DUTY the fraction of each period that
 stays painted. A period near half a cell gives roughly two bands per square at SQUARE_SIZE = 1/2.
*/
export const STRIPE_PERIOD = 0.22;
export const STRIPE_DUTY = 0.5;

/*
 The height stepper. The map stores a height WINDOW per (watcher, cell), not a boolean, because the
 drain phase tests line of sight to the target's FOOT height — so a cell hidden at ground level can
 be wide open once a pile is built on it, and a pile tall enough puts its occupant above every
 watcher's eye and out of reach entirely. Neither is visible in a ground-level picture, and both
 matter most exactly where a player or a bot would want to build.

 So the overlay answers for a body standing on `pileBoulders` boulders, steppable at runtime. The
 squares rise with it, which is the point: you are looking at the plane you are asking about, and
 cells flipping blue -> red as boulders go under them is the height window made visible.

 Half a level per boulder, matching the movement model in game/botGeometry.ts (an eye at
 tileHeight + 0.5 + 0.875 after raising one).
*/
export const BOULDER_HEIGHT = 0.5;
export const MAX_PILE_BOULDERS = 10;

// ---------------------------------------------------------------------------------------------

export interface ExposureOverlay {
	mesh: InstancedMesh;
	// How many boulders the overlay assumes are stacked under the body it is answering for. 0 is
	// bare ground. Stepped at runtime — see handleExposureKeys and setExposurePile.
	pileBoulders: number;
	// Per-instance 0/1: is this cell's next exposure waiting on a held turn? See STRIPE_PERIOD.
	held: InstancedBufferAttribute;
	// Cell behind each instance, so an update can walk instances instead of the whole grid.
	cells: { col: number; row: number; height: number }[];
}

export function createExposureOverlay(level: Level, map: number[], disposer: Disposer): ExposureOverlay {
	const cells: { col: number; row: number; height: number }[] = [];
	for (let row = 0; row < MAP_SIZE - 1; row++) {
		for (let col = 0; col < MAP_SIZE - 1; col++) {
			// Flat cells only — nothing stands on a slope, so nothing there can be drained.
			if (level.shapes[row * MAP_SIZE + col] !== 0) continue;
			cells.push({ col, row, height: map[row * MAP_SIZE + col] });
		}
	}

	// PlaneGeometry faces +Z; lay it flat so it faces up.
	const geometry = new PlaneGeometry(SQUARE_SIZE, SQUARE_SIZE);
	geometry.rotateX(-Math.PI / 2);
	/*
	 The held marker, per instance. InstancedMesh gives colour per instance for free but neither
	 opacity nor a pattern — both are material-level — so `held` arrives as an instanced attribute
	 and the shader acts on it. Same patch point the object fade uses
	 (world/objects/models/index.ts): append after <dithering_fragment>.

	 `vStripe` is the fragment's WORLD-space x+z, carried through so the diagonal bands are
	 continuous across neighbouring cells instead of restarting inside each square. It costs one
	 varying whichever style is selected, which is cheaper than compiling two materials.

	 One draw call still. The alternative — a second mesh for the held cells — would cost a matrix
	 re-upload every refresh and split the overlay in two for a purely visual distinction.
	*/
	const held = new InstancedBufferAttribute(new Float32Array(Math.max(1, cells.length)), 1);
	geometry.setAttribute('held', held);
	/*
	 NO polygonOffset here, and that is a finding rather than an omission. The squares flickering
	 during a body transfer looked exactly like z-fighting — 0.02 above the ground, a camera running
	 near 0.01 / far 2000, so almost no depth precision left at range — but adding polygon offset
	 made it markedly WORSE and made it fire on short transfers too. Whatever the flicker is, the
	 depth comparison is not it. Reverted rather than retuned; see PLAN-EXPOSURE.md.
	*/
	/*
	 NOT `transparent: true` — this line is load-bearing, and it is what fixed the flicker.

	 The squares used to vanish for a fraction of a second, most often during a body transfer.
	 Transparency put this mesh in the SORTED pass, where Three orders objects by the depth of the
	 OBJECT'S ORIGIN. This mesh's origin is world (0,0,0), the corner of the map, while its
	 instances cover the entire landscape — so its sort key is close to meaningless and swings
	 around as the camera moves. It shared that pass with exactly what a transfer produces: two
	 crossfading bodies and any live particle burst. Draw order flipped between frames.

	 It was only ever transparent because the first version faded held cells with alpha. Since the
	 hatching is cut with `discard`, every surviving fragment is fully opaque and this belongs in
	 the opaque pass, where it is also depth-sorted front-to-back and gets early-Z for free.

	 (The flicker looked exactly like z-fighting and was not: see the polygonOffset note above.)
	*/
	const material = new MeshBasicMaterial({ side: DoubleSide });
	material.onBeforeCompile = shader => {
		shader.vertexShader =
			`attribute float held;
			varying float vHeld;
			varying float vStripe;
			` +
			shader.vertexShader.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vHeld = held;
				#ifdef USE_INSTANCING
					vec4 exposureWorld = instanceMatrix * vec4( transformed, 1.0 );
					vStripe = exposureWorld.x + exposureWorld.z;
				#else
					vStripe = transformed.x + transformed.z;
				#endif`
			);
		// Discarding rather than fading also means the gaps write no depth, so nothing is paid for
		// a fragment that contributes nothing.
		shader.fragmentShader =
			`varying float vHeld;
			varying float vStripe;
			` +
			shader.fragmentShader.replace(
				'#include <dithering_fragment>',
				`#include <dithering_fragment>
				if ( vHeld > 0.5 && fract( vStripe / ${STRIPE_PERIOD.toFixed(4)} ) > ${STRIPE_DUTY.toFixed(4)} ) discard;`
			);
	};
	/*
	 Three keys its compiled-program cache on the material's own parameters and does NOT look at
	 onBeforeCompile. Two materials whose parameters happen to match therefore share one program,
	 and whichever compiled first wins — so a patched material can silently end up running an
	 unpatched program (or vice versa). Nothing in the scene currently collides with this one
	 (engine/particles.ts is opaque FrontSide, engine/cones.ts is additive with depthWrite off),
	 but the collision is invisible when it happens and this is the documented way to prevent it.
	*/
	material.customProgramCacheKey = () => 'exposureOverlay';
	disposer.register(geometry);
	disposer.register(material);

	const mesh = new InstancedMesh(geometry, material, Math.max(1, cells.length));
	mesh.count = cells.length;
	mesh.visible = false;
	/*
	 Three computes InstancedMesh.boundingSphere lazily on first render and never invalidates it
	 (see engine/particles.ts, which was bitten by exactly that). The matrices here are all written
	 before the mesh is ever drawn, so the cached sphere is correct today — but this one object
	 spans the whole map, so culling it can only pay off when the entire landscape is off-screen,
	 which never happens in first-person play. Skipping the test costs nothing and removes a stale
	 cached volume as a possible cause of anything.
	*/
	mesh.frustumCulled = false;
	// Same marker the cone overlay carries: never let a debug aid intercept the crosshair, and
	// never let it block a watcher's line of sight.
	mesh.userData = { skipRaycast: true };
	disposer.register(mesh);

	const overlay: ExposureOverlay = { mesh, cells, held, pileBoulders: 0 };
	placeSquares(overlay);
	return overlay;
}

/*
 The height the overlay is currently answering for on a given cell: the foot of a body standing on
 `pileBoulders` boulders. One helper so the squares, the colouring and the crosshair readout can
 never disagree about which plane is being asked about.
*/
export function assumedHeight(overlay: ExposureOverlay, cellHeight: number): number {
	return cellHeight + overlay.pileBoulders * BOULDER_HEIGHT;
}

// Lift every square to the plane currently being asked about. Only on a step, never per frame.
function placeSquares(overlay: ExposureOverlay): void {
	const matrix = new Matrix4();
	for (let i = 0; i < overlay.cells.length; i++) {
		const { col, row, height } = overlay.cells[i];
		matrix.makeTranslation(col + 0.5, assumedHeight(overlay, height) + HOVER_HEIGHT, MAP_SIZE - 1 - (row + 0.5));
		overlay.mesh.setMatrixAt(i, matrix);
	}
	overlay.mesh.instanceMatrix.needsUpdate = true;
}

/*
 Step the assumed pile. Returns whether anything moved, so the caller can repaint only then — the
 4 Hz tick that normally repaints does not run in BIRDSEYE or before the first action, which is
 exactly when someone would be standing still stepping through heights.
*/
export function setExposurePile(overlay: ExposureOverlay, boulders: number): boolean {
	const clamped = Math.max(0, Math.min(MAX_PILE_BOULDERS, Math.round(boulders)));
	if (clamped === overlay.pileBoulders) return false;
	overlay.pileBoulders = clamped;
	placeSquares(overlay);
	return true;
}

/*
 The stepper's keys. PageUp / PageDown add and remove a boulder, Home returns to bare ground.

 Named keys rather than punctuation on purpose: engine/input.ts tracks KeyboardEvent.key, so `,`
 and `.` sit in different physical places on an AZERTY keyboard while PageUp/PageDown/Home do not
 move at all.

 Structurally typed against the input manager so this module keeps no dependency on it. Returns
 whether the pile moved and leaves the repaint to the caller, which is the one that has a view —
 and which must repaint, since the 4 Hz tick does not run in BIRDSEYE or before the first action,
 exactly when someone stands still stepping through heights.
*/
export function handleExposureKeys(
	input: { consumeJustPressed(key: string): boolean },
	overlay: ExposureOverlay
): boolean {
	let target = overlay.pileBoulders;
	if (input.consumeJustPressed('PageUp')) target += 1;
	if (input.consumeJustPressed('PageDown')) target -= 1;
	if (input.consumeJustPressed('Home')) target = 0;
	return setExposurePile(overlay, target);
}

// Scratch colours, reused across every instance of every refresh.
const scratch = new Color();
const rampFrom = new Color();
const rampTo = new Color();

/*
 Colour for a cell that is exposed in `ticks`: red at zero, amber half way along the ramp, green
 at the horizon and beyond. Two straight segments rather than one, so "now" and "soon" stay
 clearly distinct instead of both reading as orange.
*/
function rampColor(ticks: number, out: Color): Color {
	const t = Math.min(1, ticks / RAMP_HORIZON_TICKS);
	if (t <= 0.5) {
		rampFrom.setHex(COLOR_IN_SIGHT);
		rampTo.setHex(COLOR_SOON);
		return out.lerpColors(rampFrom, rampTo, t * 2);
	}
	rampFrom.setHex(COLOR_SOON);
	rampTo.setHex(COLOR_CLEAR);
	return out.lerpColors(rampFrom, rampTo, (t - 0.5) * 2);
}

/*
 Repaint every square from a view of the map (engine/exposureSensor.ts).

 Called from the 4 Hz game tick rather than per frame: a cell's colour is a function of the
 watchers' clocks, and those only move on a tick. A drain-locked watcher's clock does not move at
 all, so its whole sector visibly freezes — which is the single most useful thing this overlay
 shows, because it is the behaviour game/cone.ts could only approximate.
*/
export function refreshExposureOverlay(overlay: ExposureOverlay, view: ExposureView): void {
	for (let i = 0; i < overlay.cells.length; i++) {
		const { col, row, height } = overlay.cells[i];

		// The height being asked about, not the terrain: with boulders assumed under the body, a
		// cell hidden at ground level can be fully exposed and a tall enough pile is out of reach
		// of every eye. See BOULDER_HEIGHT.
		const at = assumedHeight(overlay, height);
		const reading = view.read(col, row, at);
		if (reading.ticks === Infinity) scratch.setHex(reading.aboveEveryEye ? COLOR_ABOVE_EYE : COLOR_HIDDEN);
		else rampColor(reading.ticks, scratch);
		// A held cell keeps its ramp colour and is hatched instead: the colour still answers "when,
		// once the watcher stops eating", which is what a plan is built from.
		overlay.held.setX(i, reading.held ? 1 : 0);
		overlay.mesh.setColorAt(i, scratch);
	}
	if (overlay.mesh.instanceColor) overlay.mesh.instanceColor.needsUpdate = true;
	overlay.held.needsUpdate = true;
}
