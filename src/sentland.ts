/*
 Landscape generator for The Sentinel (aka The Sentry)
 Generates the landscapes from the original game, excluding placed objects.
 Totally based on the Python version from Simon Owen https://github.com/simonowen/sentland
*/

// -------------------------- Utils --------------------------

const range = (v: number) =>
	Array(v)
		.fill(0)
		.map((_, i) => i);

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const max = (a: number[]) => a.reduce((m, v) => Math.max(m, v), -Infinity);
const lpad = (s: string, c: string, n: number) => c.repeat(n - s.length) + s;
const decAsHex = (v: number) => parseInt(v.toString(10), 16);

// -------------------------- RNG --------------------------

let ull: bigint;
let rngUsage: number;

// Seed RNG using landscape number
function seed(val: number) {
	ull = (1n << 16n) | BigInt(val);
	rngUsage = 0;

	// Read 81 values to warm the RNG.
	for (let i = 0; i <= 80; i++) rng256();
}

function getRngState() {
	return ull;
}

function setRngState(state: bigint) {
	ull = state;
}

// Pull next 8-bit value from random number generator
export function rng256() {
	for (let i = 0; i < 8; i++) {
		ull <<= 1n;
		ull |= ((ull >> 20n) ^ (ull >> 33n)) & 1n;
	}

	const value = Number((ull >> 32n) & 0xffn);
	ull &= 0xffffffffffn;
	rngUsage += 1;
	return value;
}

// Random number in range 0 to 0x16
function rng16() {
	const r = rng256();
	return (r & 7) + ((r >> 3) & 0xf);
}

const rngn = (n: number) => range(n).map(rng256);

// Calculate random map axis coordinate
// TODO: adapt to use with dim
function randomCoord() {
	while (true) {
		const r = rng256() & 0x1f;
		if (r < 0x1f) return r;
	}
}

function rngBCD() {
	const x = rng256();

	// Left digit
	let a = (x >> 4) & 0xf;
	if (a > 9) a -= 6;

	// Right digit
	let b = (x >> 0) & 0xf;
	if (b > 9) b -= 6;

	return (a << 4) | b;
}

// -------------------------- Code generation --------------------------

function generateCodePart(system: string): number {
	if (system === 'BBC/C64') return rngBCD();

	// PC, ST and Amiga consume 3 additional rands
	if (system === 'PC/ST' || system === 'Amiga') range(3).forEach(_ => rng256());

	const b = rngBCD();
	const a = rngBCD();

	// CPC and Amiga swap nibbles
	if (system === 'CPC' || system === 'Amiga') {
		return ((b >> 4) & 0x0f) + ((a << 4) & 0xf0);
	} else {
		return (b & 0x0f) + (a & 0xf0);
	}
}

function generateCode(system: string) {
	// Advance the RNG in digit pairs, for the code check obfuscation.
	range(0xa5 - 0x80 + 1).forEach(_ => generateCodePart(system));

	// The code is the next 4 values
	return range(4)
		.map(v => lpad(generateCodePart(system).toString(16), '0', 2))
		.join('');
}

// -------------------------- Map manipulations --------------------------

// Smooth the map by averaging groups across the given axis
function smooth(map: number[], dim: number, axis: string): number[] {
	const nb = 4;
	const newMap = Array(dim * dim);
	if (axis === 'z') {
		for (let z = 0; z < dim; z++)
			for (let x = 0; x < dim; x++)
				newMap[z * dim + x] = Math.floor(sum(range(nb).map(i => map[z * dim + ((x + i) % dim)])) / nb);
	} else {
		for (let x = 0; x < dim; x++)
			for (let z = 0; z < dim; z++)
				newMap[z * dim + x] = Math.floor(sum(range(nb).map(i => map[((z + i) % dim) * dim + x])) / nb);
	}
	return newMap;
}

// Smooth 3 map vertices, returning a new central vertex height
function despikeMidval(v1: number, v2: number, v3: number): number {
	if (v2 === v3) return v2;
	if (v2 > v3) {
		if (v2 <= v1) return v2;
		if (v1 < v3) return v3;
		return v1;
	}
	if (v2 >= v1) return v2;
	if (v3 < v1) return v3;
	return v1;
}

// De-spike the map in slices across the given axis
function despike(map: number[], dim: number, axis: string): number[] {
	const newMap = map.slice();
	if (axis == 'z') {
		for (let z = 0; z < dim; z++) {
			// initialize a slightly longer row copy
			const v = Array(dim + 3);
			for (let x = 0; x < dim + 3; x++) v[x] = newMap[z * dim + (x % dim)];
			// despike it
			for (let x = dim - 1; x >= 0; x--) v[x + 1] = despikeMidval(v[x], v[x + 1], v[x + 2]);
			// copy back updated values
			for (let x = 0; x < dim; x++) newMap[z * dim + x] = v[x];
		}
	} else {
		for (let x = 0; x < dim; x++) {
			// initialize a slightly longer row copy
			const v = Array(dim + 3);
			for (let z = 0; z < dim + 3; z++) v[z] = newMap[(z % dim) * dim + x];
			// despike it
			for (let z = dim - 1; z >= 0; z--) v[z + 1] = despikeMidval(v[z], v[z + 1], v[z + 2]);
			// copy back updated values
			for (let z = 0; z < dim; z++) newMap[z * dim + x] = v[z];
		}
	}
	return newMap;
}

// Scale and offset values to generate vertex heights
function scaleAndOffset(val: number, scale: number) {
	// center on 0, scale, then divide by 256. centre at 6 and limit minimum. raise by 1 and limit maximum;
	return Math.min(Math.max((((val - 0x80) * scale) >> 8) + 6, 0) + 1, 11);
}

// Determine tile shape code from 4 vertex heights
function tileShape(fl: number, bl: number, br: number, fr: number) {
	/*
		0 = flat
	
		1 = 0001 = flat slope to back
		9 = 1001 = flat slope to front
		5 = 0101 = flat slope to right
		d = 1101 = flat slope to left
	
		2 = 0010 = 3 up one down: br=fr=bl, down to fl
		3 = 0011 = 3 up one down: fl=fr=bl, down to br
		7 = 0111 = 3 up one down: fl=bl=br, down to fr
		f = 1111 = 3 up one down: fl=fr=br, down to bl
	
		b = 1011 = 3 down one up: br=fr=bl, up to fl
		a = 1010 = 3 down one up: fl=fr=bl, up to br
		e = 1110 = 3 down one up: fl=bl=br, up to fr
		6 = 0110 = 3 down one up: fl=fr=br, up to bl
	
		4 = 0100 = fl=bl, fl!=fr, br!=bl, br!=fr || br=fr, fl!=fr, fl!=bl, br!=bl
		c = 1100 = fl!=fr, fl!=bl, br!=fr || fl=fr, fl!=bl, br!=bl, br!=fr
	*/
	let shape: number;
	if (fl === fr)
		if (fl === bl)
			if (fl === br) shape = 0;
			else if (fl < br) shape = 0xa;
			else shape = 0x3;
		else if (br === bl)
			if (br < fr) shape = 0x1;
			else shape = 0x9;
		else if (br === fr)
			if (br < bl) shape = 0x6;
			else shape = 0xf;
		else shape = 0xc;
	else if (fl === bl)
		if (br === fr)
			if (br < bl) shape = 0x5;
			else shape = 0xd;
		else if (br === bl)
			if (br < fr) shape = 0xe;
			else shape = 0x7;
		else shape = 0x4;
	else if (br === fr)
		if (br === bl)
			if (br < fl) shape = 0xb;
			else shape = 0x2;
		else shape = 0x4;
	else shape = 0xc;

	return shape;
}

// Add tile shape code to upper 4 bits of each tile
function addTileShapes(map: number[], dim: number): number[] {
	const shapes = Array(dim * dim);
	for (let z = dim - 2; z >= 0; z--) {
		for (let x = dim - 2; x >= 0; x--) {
			const fl = map[z * dim + x] & 0xf;
			const fr = map[z * dim + x + 1] & 0xf;
			const br = map[(z + 1) * dim + x + 1] & 0xf;
			const bl = map[(z + 1) * dim + x] & 0xf;
			shapes[z * dim + x] = tileShape(fl, bl, br, fr);
		}
	}
	return shapes;
}

// -------------------------- Object placement --------------------------

export enum GameObjType {
	SYNTHOID = 0,
	SENTRY = 1,
	TREE = 2,
	BOULDER = 3,
	MEANIE = 4,
	SENTINEL = 5,
	PEDESTAL = 6,
}

class GameObject {
	rot = null;
	step = null;
	timer = null;
	constructor(public type: GameObjType, public x: number, public y: number, public z: number) {}

	// Generate string representation of object
	toString() {
		const name = GameObjType[this.type].charAt(0).toUpperCase() + GameObjType[this.type].slice(1);
		const rotdeg = this.rot === null ? null : `${((this.rot * 360) / 256).toFixed(3)}°`;
		const rotdir = this.step === null ? '' : this.step < 0 ? ' ↺' : ' ↻';

		let s = `${name.slice(0, 8)}: x=${this.x.toString(16)} y=${this.y.toString(16)} z=${this.z.toString(16)}`;
		if (this.rot !== null) s += ` rot=${this.rot.toString(16)} (${rotdeg}${rotdir})`;
		if (this.timer !== null) s += ` next=${this.timer /*:02X*/}`;
		return s;
	}
}

// Determine number of sentries on landscape
function calcNumSentries(levelId) {
	// Only ever the Sentinel on the first landscape.
	if (levelId === 0) return 1;
	const levelHex = decAsHex(levelId);

	// Base count uses landscape BCD thousands digit, offset by 2.
	const base_sentries = ((levelHex & 0xf000) >> 12) + 2;

	let num_sentries;
	while (true) {
		const r = rng256();
		// count leading zeros on b6-0 for adjustment size
		let adjust = (lpad((r & 0x7f).toString(2), '0', 7) + '1').indexOf('1');
		// b7 determines adjustment sign (note: 1s complement)
		if (r & 0x80) adjust = ~adjust;

		num_sentries = base_sentries + adjust;
		if (0 <= num_sentries && num_sentries <= 7) break;
	}

	// Levels under 100 use tens digit to limit number of sentries.
	let max_sentries = (levelHex & 0x00f0) >> 4;
	if (levelHex >= 0x0100 || max_sentries > 7) max_sentries = 7;

	// Include Sentinel in sentry count.
	return 1 + Math.min(num_sentries, max_sentries);
}

// Find the highest placement positions in 4x4 regions on the map
function highestPositions(map, shapes, dim) {
	const grid_max: { maxHeight: number; maxX: number; maxZ: number }[] = [];

	// Scan the map as 64 regions of 4x4 (less one on right/back edges)
	// in z order from front to back and x from left to right.
	for (let i of range(0x40)) {
		const gridx = (i & 7) << 2;
		const gridz = (i & 0x38) >> 1;
		let maxHeight = 0;
		let maxX = -1;
		let maxZ = -1;

		// Scan each 4x4 region, z from front to back, x from left to right.
		for (let j of range(0x10)) {
			const x = gridx + (j & 3);
			const z = gridz + (j >> 2);

			// The back and right edges are missing a tile, so skip.
			if (x === 0x1f || z === 0x1f) continue;

			const height = map[z * dim + x];
			if (shapes[z * dim + x] === 0 && height >= maxHeight) {
				[maxHeight, maxX, maxZ] = [height, x, z];
			}
		}
		grid_max.push({ maxHeight, maxX, maxZ });
	}
	return grid_max;
}

// Place object at given position but with random rotation
function createObjectAt(type: GameObjType, x: number, y: number, z: number): GameObject {
	const obj = new GameObject(type, x, y, z);

	// Random rotation, limited to 32 steps, biased by +135 degrees.
	obj.rot = ((rng256() & 0xf8) + 0x60) & 0xff;
	return obj;
}

// Return a list of objects stacked at map location
function objectsAt(objects: GameObject[], x: number, z: number) {
	return objects.filter(o => o.x === x && o.z === z);
}

/// Generate given object at a random unused position below the given height
function createObjectRandom(type, maxHeight, objects, map, shapes, dim): GameObject {
	while (true) {
		for (let i = 0; i < 255; i++) {
			const x = randomCoord();
			const z = randomCoord();
			const y = map[z * dim + x];

			if (shapes[z * dim + x] === 0 && objectsAt(objects, x, z).length === 0 && y < maxHeight)
				return createObjectAt(type, x, y, z);
		}

		maxHeight += 1;
		if (maxHeight >= 0xc) return null;
	}
}

// Place Sentinel and appropriate sentry count for given landscape
function placeSentries(map, shapes, dim, objects, nbSentries) {
	const highest = highestPositions(map, shapes, dim);
	let maxHeight = max(highest.map(x => x.maxHeight));

	for (let i = 0; i < nbSentries; i++) {
		let heightIndices: number[];
		while (true) {
			// Filter for high positions at the current height limit.
			heightIndices = highest.map((x, i) => (x.maxHeight === maxHeight ? i : null)).filter(v => v !== null);
			if (heightIndices.length > 0) break;

			// No locations so try 1 level down, stopping at zero.
			maxHeight -= 1;
			if (maxHeight == 0) return [objects, maxHeight];
		}

		// Results are in reverse order due to backwards 6502 iteration loop.
		heightIndices = heightIndices.reverse();

		// Mask above number of entries to limit random scope.
		const idx_mask = 0xff >> lpad(heightIndices.length.toString(2), '0', 8).indexOf('1');
		let idx;
		while (true) {
			idx = rng256() & idx_mask;
			if (idx < heightIndices.length) break;
		}

		const idx_grid = heightIndices[idx];
		const { maxHeight: y, maxX: x, maxZ: z } = highest[idx_grid];

		// Invalidate the selected and surrounding locations by setting zero height.
		for (let offset of [-9, -8, -7, -1, 0, 1, 7, 8, 9]) {
			const idx_clear = idx_grid + offset;
			if (idx_clear >= 0 && idx_clear < highest.length) highest[idx_clear].maxHeight = 0;
		}

		let object;
		if (objects.length == 0) {
			const pedestal = createObjectAt(GameObjType.PEDESTAL, x, y, z);
			pedestal.rot = 0;
			objects.push(pedestal);
			object = createObjectAt(GameObjType.SENTINEL, x, y + 1, z);
		} else {
			object = createObjectAt(GameObjType.SENTRY, x, y, z);
		}
		objects.push(object);

		// Generate rotation step/direction and timer delay from RNG.
		const r = rng256();
		object.step = r & 1 ? -20 : 20;
		object.timer = ((r >> 1) & 0x1f) | 5;
	}

	return maxHeight;
}

// Place player robot on the landscape
function placePlayer(map, shapes, dim, objects, maxHeight, isFirstLevel) {
	let player;
	// The player position is fixed on landscape 0000.
	if (isFirstLevel) {
		const x = 0x08;
		const z = 0x11;
		player = createObjectAt(GameObjType.SYNTHOID, x, map[z * dim + x], z);
	} else {
		// Player is never placed above height 6.
		const maxPlayerHeight = Math.min(maxHeight, 6);
		player = createObjectRandom(GameObjType.SYNTHOID, maxPlayerHeight, objects, map, shapes, dim);
	}
	objects.push(player);
}

// Place the appropriate number of trees for the sentry count
function placeTrees(map, shapes, dim, objects, maxHeight) {
	// Count the placed Sentinel and sentries.
	const num_sents = objects.filter(o => o.type === GameObjType.SENTINEL || o.type === GameObjType.SENTRY).length;

	const r = rng256();
	const max_trees = 48 - 3 * num_sents;
	const num_trees = Math.min((r & 7) + ((r >> 3) & 0xf) + 10, max_trees);

	for (let i of range(num_trees)) {
		const tree = createObjectRandom(GameObjType.TREE, maxHeight, objects, map, shapes, dim);
		// if failed to position item, give up
		if (tree === null) break;
		objects.push(tree);
	}
}

// -------------------------- Map generation --------------------------

export interface LandscapeOptions {
	dim: number;
	smooths: number;
	despikes: number;
}

export function generateLandscape(
	levelId: number,
	options?: LandscapeOptions
): {
	map: number[];
	shapes: number[];
	objects: GameObject[];
	codes: Record<string, string>;
	nbSentries: number;
	nbRng: number;
} {
	let dim = options?.dim || 0x20;
	let smooths = options?.smooths ?? 2;
	let despikes = options?.despikes ?? 2;

	// Seed RNG using landscape number in BCD.
	seed(decAsHex(levelId));

	// Random height scaling (but fixed value for landscape 0000!).
	const height_scale = levelId > 0 ? rng16() + 0x0e : 0x18;

	// Fill the map with random values (z from back to front, x from right to left).
	let map = rngn(dim * dim).reverse();

	// smoothing, each across z-axis then x-axis.
	for (let i = 0; i < smooths; i++) {
		map = smooth(map, dim, 'z');
		map = smooth(map, dim, 'x');
	}

	// Scale and offset values to give vertex heights in range 1 to 11.
	map = map.map(v => scaleAndOffset(v, height_scale));

	// despiking, to maximize the number of flat cells
	for (let i = 0; i < despikes; i++) {
		map = despike(map, dim, 'z');
		map = despike(map, dim, 'x');
	}

	// Add shape codes for each tile, to simplify examining the landscape.
	const shapes = addTileShapes(map, dim);

	const objects = [];
	const nbSentries = calcNumSentries(levelId);
	const maxHeight = placeSentries(map, shapes, dim, objects, nbSentries);
	placePlayer(map, shapes, dim, objects, maxHeight, levelId === 0);
	placeTrees(map, shapes, dim, objects, maxHeight);

	const nbRng = rngUsage;

	// Save RNG state as the starting point to generate codes.
	const state = getRngState();
	const codes: Record<string, string> = {};
	['BBC/C64', 'CPC', 'Spectrum', 'PC/ST', 'Amiga'].forEach(system => {
		setRngState(state);
		codes[system] = generateCode(system);
	});

	return { map, shapes, objects, codes, nbSentries, nbRng };
}
