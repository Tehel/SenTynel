export const sentinel = {
	v: [
		[0.24609375, 0.890625, -0.12109375],
		[0.10546875, 0.9140625, -0.078125],
		[-0.10546875, 0.9140625, -0.078125],
		[-0.24609375, 0.890625, -0.12109375],
		[-0.10546875, 0.9375, 0.078125],
		[0.10546875, 0.9375, 0.078125],
		[0.06640625, 0.9375, 0.2421875],
		[-0.06640625, 0.9375, 0.2421875],
		[-0.17578125, 0, -0.12890625],
		[-0.1328125, 0.125, -0.09765625],
		[0.1328125, 0.125, -0.09765625],
		[0.17578125, 0, -0.12890625],
		[-0.17578125, 0, 0.12890625],
		[-0.1328125, 0.125, 0.09765625],
		[0.1328125, 0.125, 0.09765625],
		[0.17578125, 0, 0.12890625],
		[-0.1328125, 0.7890625, -0.09765625],
		[0.1328125, 0.7890625, -0.09765625],
		[-0.2109375, 0.7890625, 0],
		[0.2109375, 0.7890625, 0],
		[0.05078125, 0.8125, 0.1875],
		[-0.05078125, 0.8125, 0.1875],
		[0.08984375, 1.0625, 0.09765625],
		[0.05859375, 1.1796875, 0.046875],
		[-0.05859375, 1.1796875, 0.046875],
		[-0.08984375, 1.0625, 0.09765625],
		[-0.0546875, 1.1796875, -0.07421875],
		[0.0546875, 1.1796875, -0.07421875],
		[-0.046875, 1.0078125, 0.2421875],
		[0.046875, 1.0078125, 0.2421875],
	],
	f: [
		{ v: [1, 2, 3], color: 0x000000 }, // head bottom rear
		{ v: [1, 3, 4], color: 0x000000 }, // head bottom rear
		{ v: [3, 5, 4], color: 0x000000 }, // head bottom right
		{ v: [1, 6, 2], color: 0x000000 }, // head bottom left
		{ v: [6, 7, 8], color: 0x000000 }, // beak bottom
		{ v: [6, 8, 5], color: 0x000000 }, // beak bottom
		{ v: [9, 10, 11], color: 0xff0000 }, // foot back
		{ v: [9, 11, 12], color: 0xff0000 }, // foot back
		{ v: [13, 14, 10], color: 0x000000 }, // foot right
		{ v: [13, 10, 9], color: 0x000000 }, // foot right
		{ v: [12, 11, 15], color: 0x000000 }, // foot left
		{ v: [12, 15, 16], color: 0x000000 }, // foot left
		{ v: [16, 15, 14], color: 0x000000 }, // foot front
		{ v: [16, 14, 13], color: 0x000000 }, // foot front
		{ v: [10, 17, 18], color: 0x000000 }, // back
		{ v: [10, 18, 11], color: 0x000000 }, // back
		{ v: [14, 19, 10], color: 0x000000 }, // right
		{ v: [11, 20, 15], color: 0x000000 }, // left
		{ v: [15, 21, 22], color: 0x000000 }, // front
		{ v: [15, 22, 14], color: 0x000000 }, // front
		{ v: [10, 19, 17], color: 0xff0000 }, // back right
		{ v: [11, 18, 20], color: 0xff0000 }, // back left
		{ v: [14, 22, 19], color: 0xff0000 }, // front right
		{ v: [15, 20, 21], color: 0xff0000 }, // front left
		{ v: [19, 3, 17], color: 0xff0000 }, // shoulder back right
		{ v: [18, 2, 20], color: 0xff0000 }, // shoulder back left
		{ v: [17, 3, 2], color: 0xff0000 }, // back top
		{ v: [17, 2, 18], color: 0xff0000 }, // back top
		{ v: [19, 5, 3], color: 0x000000 }, // shoulder right
		{ v: [20, 2, 6], color: 0x000000 }, // shoulder left
		{ v: [22, 5, 19], color: -2 }, // shoulder front right
		{ v: [21, 20, 6], color: -2 }, // shoulder front left
		{ v: [21, 6, 5], color: 0x000000 }, // below beak
		{ v: [21, 5, 22], color: 0x000000 }, // below beak
		{ v: [23, 24, 25], color: 0x000000 }, // head front
		{ v: [23, 25, 26], color: 0x000000 }, // head front
		{ v: [4, 27, 28], color: 0x000000 }, // head back
		{ v: [4, 28, 1], color: 0x000000 }, // head back
		{ v: [5, 26, 4], color: 0x000000 }, // head low right
		{ v: [1, 23, 6], color: 0x000000 }, // head low left
		{ v: [8, 29, 26], color: 0xf0f000 }, // beak right
		{ v: [8, 26, 5], color: 0xf0f000 }, // beak right
		{ v: [6, 23, 30], color: 0xf0f000 }, // beak left
		{ v: [6, 30, 7], color: 0xf0f000 }, // beak left
		{ v: [30, 23, 26], color: 0xf0f000 }, // beak top
		{ v: [30, 26, 29], color: 0xf0f000 }, // beak top
		{ v: [7, 30, 29], color: 0xf0f000 }, // beak front
		{ v: [7, 29, 8], color: 0xf0f000 }, // beak front
		{ v: [24, 28, 27], color: 0x000000 }, // head top
		{ v: [24, 27, 25], color: 0x000000 }, // head top
		{ v: [26, 25, 27], color: 0xff0000 }, // head right
		{ v: [26, 27, 4], color: 0xff0000 }, // head right
		{ v: [1, 28, 24], color: 0xff0000 }, // head left
		{ v: [1, 24, 23], color: 0xff0000 }, // head left
	],
};
