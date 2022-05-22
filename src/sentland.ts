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

// -------------------------- RNG --------------------------

let ull: bigint;

// Seed RNG using landscape number
function seed(val: number) {
	ull = (1n << 16n) | BigInt(val);

	// Read 81 values to warm the RNG.
	for (let i = 0; i <= 80; i++) rng256();
}

// Pull next 8-bit value from random number generator
export function rng256() {
	for (let i = 0; i < 8; i++) {
		ull <<= 1n;
		ull |= ((ull >> 20n) ^ (ull >> 33n)) & 1n;
	}

	const value = Number((ull >> 32n) & 0xffn);
	ull &= 0xffffffffffn;
	return value;
}

// Random number in range 0 to 0x16
function rng16() {
	const r = rng256();
	return (r & 7) + ((r >> 3) & 0xf);
}

const rngn = (n: number) => range(n).map(rng256);

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

// De-spike the map in slices across the given axis
function despike(map: number[], dim: number, axis: string): number[] {
	const newMap = map.slice();
	if (axis == 'z') {
		for (let z = 0; z < dim; z++) {
			// work on a copy of the slice with the first items repeated at the end
			const v = Array(dim + 3);
			for (let x = 0; x < dim + 3; x++) v[x] = newMap[z * dim + (x % dim)];

			for (let x = dim + 1; x > 0; x--) {
				const v1 = v[x - 1];
				const v2 = v[x];
				const v3 = v[x + 1];
				v[x] = (v1 > v2 && v3 > v2) || (v1 < v2 && v3 < v2) ? Math.min(v1, v3) : v2;
			}
			for (let x = 0; x < dim; x++) newMap[z * dim + x] = v[x];
		}
	} else {
		for (let x = 0; x < dim; x++) {
			// work on a copy of the slice with the first items repeated at the end
			const v = Array(dim + 3);
			for (let z = 0; z < dim + 3; z++) v[z] = newMap[(z % dim) * dim + x];
			for (let z = dim + 1; z > 0; z--) {
				const v1 = v[z - 1];
				const v2 = v[z];
				const v3 = v[z + 1];
				v[z] = (v1 > v2 && v3 > v2) || (v1 < v2 && v3 < v2) ? Math.min(v1, v3) : v2;
			}
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

export interface LandscapeOptions {
	dim: number;
	smooths: number;
	despikes: number;
}

// -------------------------- Map generation --------------------------

export function generateLandscape(levelId: number, options?: LandscapeOptions) {
	let dim = options?.dim || 0x20;
	let smooths = options?.smooths ?? 2;
	let despikes = options?.despikes ?? 2;

	// Seed RNG using landscape number in BCD.
	seed(parseInt(levelId.toString(10), 16));

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

	return [map, shapes];
}
