export const boulder = {
	v: [
		[0.30859375, 0, 0.30859375],
		[0, 0.5, 0.4375],
		[-0.30859375, 0, 0.30859375],
		[0.30859375, 0, -0.30859375],
		[0.4375, 0.5, 0],
		[-0.30859375, 0, -0.30859375],
		[0, 0.5, -0.4375],
		[-0.4375, 0.5, 0],
	],
	f: [
		{ v: [1, 2, 3], color: 0x000042 }, // upward triangle
		{ v: [4, 5, 1], color: 0x000042 }, // upward triangle
		{ v: [6, 7, 4], color: 0x000042 }, // upward triangle
		{ v: [3, 8, 6], color: 0x000042 }, // upward triangle
		{ v: [1, 5, 2], color: 0x40a0a0 }, // downward triangle
		{ v: [4, 7, 5], color: 0x40a0a0 }, // downward triangle
		{ v: [6, 8, 7], color: 0x40a0a0 }, // downward triangle
		{ v: [3, 2, 8], color: 0x40a0a0 }, // downward triangle
		{ v: [1, 3, 6], color: 0x40a0a0 }, // bottom
		{ v: [1, 6, 4], color: 0x40a0a0 }, // bottom
		{ v: [2, 5, 7], color: 0x000042 }, // top
		{ v: [2, 7, 8], color: 0x000042 }, // top
	],
};
