import * as THREE from 'three';

interface Face {
	v: number[];
	type: string;
	props: Record<string, string | number | boolean>;
}

interface Model {
	v: number[][];
	f: Face[];
}

const sentinel: Model = {
	v: [
		[0.24609375, 0.015625, -0.12109375],
		[0.10546875, 0.0390625, -0.078125],
		[-0.10546875, 0.0390625, -0.078125],
		[-0.24609375, 0.015625, -0.12109375],
		[-0.10546875, 0.0625, 0.078125],
		[0.10546875, 0.0625, 0.078125],
		[0.06640625, 0.0625, 0.2421875],
		[-0.06640625, 0.0625, 0.2421875],
		[-0.17578125, -0.875, -0.12890625],
		[-0.1328125, -0.75, -0.09765625],
		[0.1328125, -0.75, -0.09765625],
		[0.17578125, -0.875, -0.12890625],
		[-0.17578125, -0.875, 0.12890625],
		[-0.1328125, -0.75, 0.09765625],
		[0.1328125, -0.75, 0.09765625],
		[0.17578125, -0.875, 0.12890625],
		[-0.1328125, -0.0859375, -0.09765625],
		[0.1328125, -0.0859375, -0.09765625],
		[-0.2109375, -0.0859375, 0.0],
		[0.2109375, -0.0859375, 0.0],
		[0.05078125, -0.0625, 0.1875],
		[-0.05078125, -0.0625, 0.1875],
		[0.08984375, 0.1875, 0.09765625],
		[0.05859375, 0.3046875, 0.046875],
		[-0.05859375, 0.3046875, 0.046875],
		[-0.08984375, 0.1875, 0.09765625],
		[-0.0546875, 0.3046875, -0.07421875],
		[0.0546875, 0.3046875, -0.07421875],
		[-0.046875, 0.1328125, 0.2421875],
		[0.046875, 0.1328125, 0.2421875],
	],
	f: [
		{ v: [1, 2, 3], type: 'standard', props: { color: 0x000000 } }, // head bottom rear
		{ v: [1, 3, 4], type: 'standard', props: { color: 0x000000 } }, // head bottom rear
		{ v: [3, 5, 4], type: 'standard', props: { color: 0x000000 } }, // head bottom right
		{ v: [1, 6, 2], type: 'standard', props: { color: 0x000000 } }, // head bottom left
		{ v: [6, 7, 8], type: 'standard', props: { color: 0xf0f000 } }, // beak bottom
		{ v: [6, 8, 5], type: 'standard', props: { color: 0xf0f000 } }, // beak bottom
		{ v: [9, 10, 11], type: 'standard', props: { color: 0xff0000 } }, // foot back
		{ v: [9, 11, 12], type: 'standard', props: { color: 0xff0000 } }, // foot back
		{ v: [13, 14, 10], type: 'standard', props: { color: 0x000000 } }, // foot right
		{ v: [13, 10, 9], type: 'standard', props: { color: 0x000000 } }, // foot right
		{ v: [12, 11, 15], type: 'standard', props: { color: 0x000000 } }, // foot left
		{ v: [12, 15, 16], type: 'standard', props: { color: 0x000000 } }, // foot left
		{ v: [16, 15, 14], type: 'standard', props: { color: 0x000000 } }, // foot front
		{ v: [16, 14, 13], type: 'standard', props: { color: 0x000000 } }, // foot front
		{ v: [10, 17, 18], type: 'standard', props: { color: 0x000000 } }, // back
		{ v: [10, 18, 11], type: 'standard', props: { color: 0x000000 } }, // back
		{ v: [14, 19, 10], type: 'standard', props: { color: 0x000000 } }, // right
		{ v: [11, 20, 15], type: 'standard', props: { color: 0x000000 } }, // left
		{ v: [15, 21, 22], type: 'standard', props: { color: 0x000000 } }, // front
		{ v: [15, 22, 14], type: 'standard', props: { color: 0x000000 } }, // front
		{ v: [10, 19, 17], type: 'standard', props: { color: 0xff0000 } }, // back right
		{ v: [11, 18, 20], type: 'standard', props: { color: 0xff0000 } }, // back left
		{ v: [14, 22, 19], type: 'standard', props: { color: 0xff0000 } }, // front right
		{ v: [15, 20, 21], type: 'standard', props: { color: 0xff0000 } }, // front left
		{ v: [19, 3, 17], type: 'standard', props: { color: 0xff0000 } }, // shoulder back right
		{ v: [18, 2, 20], type: 'standard', props: { color: 0xff0000 } }, // shoulder back left
		{ v: [17, 3, 2], type: 'standard', props: { color: 0xff0000 } }, // back top
		{ v: [17, 2, 18], type: 'standard', props: { color: 0xff0000 } }, // back top
		{ v: [19, 5, 3], type: 'standard', props: { color: 0x000000 } }, // shoulder right
		{ v: [20, 2, 6], type: 'standard', props: { color: 0x000000 } }, // shoulder left
		{ v: [22, 5, 19], type: 'standard', props: { color: 0xf0f0a0 } }, // shoulder front right
		{ v: [21, 20, 6], type: 'standard', props: { color: 0xf0f0a0 } }, // shoulder front left
		{ v: [21, 6, 5], type: 'standard', props: { color: 0x000000 } }, // below beak
		{ v: [21, 5, 22], type: 'standard', props: { color: 0x000000 } }, // below beak
		{ v: [23, 24, 25], type: 'standard', props: { color: 0x000000 } }, // head front
		{ v: [23, 25, 26], type: 'standard', props: { color: 0x000000 } }, // head front
		{ v: [4, 27, 28], type: 'standard', props: { color: 0x000000 } }, // head back
		{ v: [4, 28, 1], type: 'standard', props: { color: 0x000000 } }, // head back
		{ v: [5, 26, 4], type: 'standard', props: { color: 0x000000 } }, // head low right
		{ v: [1, 23, 6], type: 'standard', props: { color: 0x000000 } }, // head low left
		{ v: [8, 29, 26], type: 'standard', props: { color: 0xf0f000 } }, // beak right
		{ v: [8, 26, 5], type: 'standard', props: { color: 0xf0f000 } }, // beak right
		{ v: [6, 23, 30], type: 'standard', props: { color: 0xf0f000 } }, // beak left
		{ v: [6, 30, 7], type: 'standard', props: { color: 0xf0f000 } }, // beak left
		{ v: [30, 23, 26], type: 'standard', props: { color: 0xf0f000 } }, // beak top
		{ v: [30, 26, 29], type: 'standard', props: { color: 0xf0f000 } }, // beak top
		{ v: [7, 30, 29], type: 'standard', props: { color: 0xf0f000 } }, // beak front
		{ v: [7, 29, 8], type: 'standard', props: { color: 0xf0f000 } }, // beak front
		{ v: [24, 28, 27], type: 'standard', props: { color: 0x000000 } }, // head top
		{ v: [24, 27, 25], type: 'standard', props: { color: 0x000000 } }, // head top
		{ v: [26, 25, 27], type: 'standard', props: { color: 0xff0000 } }, // head right
		{ v: [26, 27, 4], type: 'standard', props: { color: 0xff0000 } }, // head right
		{ v: [1, 28, 24], type: 'standard', props: { color: 0xff0000 } }, // head left
		{ v: [1, 24, 23], type: 'standard', props: { color: 0xff0000 } }, // head left
	],
};

const tree: Model = {
	v: [
		[0, -0.5625, 0.40625],
		[-0.2890625, -0.5625, 0.2890625],
		[-0.40625, -0.5625, 0],
		[0.2890625, -0.5625, 0.2890625],
		[-0.2890625, -0.5625, -0.2890625],
		[0.40625, -0.5625, 0],
		[0, -0.5625, -0.40625],
		[0.2890625, -0.5625, -0.2890625],
		[0.06640625, -0.875, 0.06640625],
		[0.06640625, -0.5625, 0.06640625],
		[-0.06640625, -0.5625, 0.06640625],
		[-0.06640625, -0.875, 0.06640625],
		[0.06640625, -0.875, -0.06640625],
		[0.06640625, -0.5625, -0.06640625],
		[-0.06640625, -0.5625, -0.06640625],
		[-0.06640625, -0.875, -0.06640625],
		[0, 0.9375, 0],
	],
	f: [
		{ v: [1, 2, 3], type: 'standard', props: { color: 0x280a00 } }, // bottom
		{ v: [1, 3, 4], type: 'standard', props: { color: 0x280a00 } }, // bottom
		{ v: [4, 3, 5], type: 'standard', props: { color: 0x280a00 } }, // bottom
		{ v: [4, 5, 6], type: 'standard', props: { color: 0x280a00 } }, // bottom
		{ v: [6, 5, 7], type: 'standard', props: { color: 0x280a00 } }, // bottom
		{ v: [6, 7, 8], type: 'standard', props: { color: 0x280a00 } }, // bottom
		{ v: [9, 10, 11], type: 'standard', props: { color: 0x671b00 } }, // trunk
		{ v: [9, 11, 12], type: 'standard', props: { color: 0x671b00 } }, // trunk
		{ v: [13, 14, 10], type: 'standard', props: { color: 0x3f0f00 } }, // trunk
		{ v: [13, 10, 9], type: 'standard', props: { color: 0x3f0f00 } }, // trunk
		{ v: [12, 11, 15], type: 'standard', props: { color: 0x3f0f00 } }, // trunk
		{ v: [12, 15, 16], type: 'standard', props: { color: 0x3f0f00 } }, // trunk
		{ v: [16, 15, 14], type: 'standard', props: { color: 0x671b00 } }, // trunk
		{ v: [16, 14, 13], type: 'standard', props: { color: 0x671b00 } }, // trunk
		{ v: [1, 17, 2], type: 'standard', props: { color: 0x2eb032 } }, // leafs
		{ v: [4, 17, 1], type: 'standard', props: { color: 0x006204 } }, // leafs
		{ v: [6, 17, 4], type: 'standard', props: { color: 0x2eb032 } }, // leafs
		{ v: [8, 17, 6], type: 'standard', props: { color: 0x006204 } }, // leafs
		{ v: [7, 17, 8], type: 'standard', props: { color: 0x2eb032 } }, // leafs
		{ v: [5, 17, 7], type: 'standard', props: { color: 0x006204 } }, // leafs
		{ v: [3, 17, 5], type: 'standard', props: { color: 0x2eb032 } }, // leafs
		{ v: [2, 17, 3], type: 'standard', props: { color: 0x006204 } }, // leafs
	],
};

const pedestal: Model = {
	v: [
		[0.5, -0.875, 0.5],
		[0.265625, 0.125, 0.5],
		[-0.265625, 0.125, 0.5],
		[-0.5, -0.875, 0.5],
		[0.5, -0.875, -0.5],
		[0.5, 0.125, -0.265625],
		[0.5, 0.125, 0.265625],
		[-0.5, -0.875, -0.5],
		[-0.265625, 0.125, -0.5],
		[0.265625, 0.125, -0.5],
		[-0.5, 0.125, 0.265625],
		[-0.5, 0.125, -0.265625],
	],
	f: [
		{ v: [1, 2, 3], type: 'standard', props: { color: 0x000000 } }, // side
		{ v: [1, 3, 4], type: 'standard', props: { color: 0x000000 } }, // side
		{ v: [5, 6, 7], type: 'standard', props: { color: 0xffffff } }, // side
		{ v: [5, 7, 1], type: 'standard', props: { color: 0xffffff } }, // side
		{ v: [8, 9, 10], type: 'standard', props: { color: 0x000000 } }, // side
		{ v: [8, 10, 5], type: 'standard', props: { color: 0x000000 } }, // side
		{ v: [4, 11, 12], type: 'standard', props: { color: 0xffffff } }, // side
		{ v: [4, 12, 8], type: 'standard', props: { color: 0xffffff } }, // side
		{ v: [4, 3, 11], type: 'standard', props: { color: 0xf0f000 } }, // diamonds
		{ v: [1, 7, 2], type: 'standard', props: { color: 0xf0f000 } }, // diamonds
		{ v: [5, 10, 6], type: 'standard', props: { color: 0xf0f000 } }, // diamonds
		{ v: [8, 12, 9], type: 'standard', props: { color: 0xf0f000 } }, // diamonds
		{ v: [2, 7, 6], type: 'standard', props: { color: 0x40a0a0 } }, // top
		{ v: [2, 6, 10], type: 'standard', props: { color: 0x40a0a0 } }, // top
		{ v: [2, 10, 9], type: 'standard', props: { color: 0x40a0a0 } }, // top
		{ v: [2, 9, 3], type: 'standard', props: { color: 0x40a0a0 } }, // top
		{ v: [3, 9, 12], type: 'standard', props: { color: 0x40a0a0 } }, // top
		{ v: [3, 12, 11], type: 'standard', props: { color: 0x40a0a0 } }, // top
	],
};

const boulder: Model = {
	v: [
		[0.30859375, -0.875, 0.30859375],
		[0.0, -0.375, 0.4375],
		[-0.30859375, -0.875, 0.30859375],
		[0.30859375, -0.875, -0.30859375],
		[0.4375, -0.375, 0.0],
		[-0.30859375, -0.875, -0.30859375],
		[0.0, -0.375, -0.4375],
		[-0.4375, -0.375, 0.0],
	],
	f: [
		{ v: [1, 2, 3], type: 'standard', props: { color: 0x000042 } }, // upward triangle
		{ v: [4, 5, 1], type: 'standard', props: { color: 0x000042 } }, // upward triangle
		{ v: [6, 7, 4], type: 'standard', props: { color: 0x000042 } }, // upward triangle
		{ v: [3, 8, 6], type: 'standard', props: { color: 0x000042 } }, // upward triangle
		{ v: [1, 5, 2], type: 'standard', props: { color: 0x40a0a0 } }, // downward triangle
		{ v: [4, 7, 5], type: 'standard', props: { color: 0x40a0a0 } }, // downward triangle
		{ v: [6, 8, 7], type: 'standard', props: { color: 0x40a0a0 } }, // downward triangle
		{ v: [3, 2, 8], type: 'standard', props: { color: 0x40a0a0 } }, // downward triangle
		{ v: [1, 3, 6], type: 'standard', props: { color: 0x40a0a0 } }, // bottom
		{ v: [1, 6, 4], type: 'standard', props: { color: 0x40a0a0 } }, // bottom
		{ v: [2, 5, 7], type: 'standard', props: { color: 0x000042 } }, // top
		{ v: [2, 7, 8], type: 'standard', props: { color: 0x000042 } }, // top
	],
};

const synthoid: Model = {
	v: [
		[0.1640625, -0.4375, -0.09375],
		[0.15625, -0.4375, 0.04296875],
		[-0.15625, -0.4375, 0.04296875],
		[-0.1640625, -0.4375, -0.09375],
		[0.0, -0.4375, 0.125],
		[0.07421875, -0.0859375, -0.0859375],
		[0.03515625, -0.0859375, 0.06640625],
		[-0.03515625, -0.0859375, 0.06640625],
		[-0.07421875, -0.0859375, -0.0859375],
		[-0.07421875, -0.875, 0.02734375],
		[-0.09765625, -0.4375, 0.0703125],
		[-0.1171875, -0.4375, -0.07421875],
		[-0.078125, -0.875, -0.07421875],
		[0.078125, -0.875, -0.07421875],
		[0.1171875, -0.4375, -0.07421875],
		[0.09765625, -0.4375, 0.0703125],
		[0.07421875, -0.875, 0.02734375],
		[-0.203125, -0.140625, 0.0234375],
		[-0.19921875, -0.140625, -0.09375],
		[0.19921875, -0.140625, -0.09375],
		[0.203125, -0.140625, 0.0234375],
		[0.0, -0.1640625, 0.125],
		[0.0, -0.078125, 0.0],
		[0.078125, -0.0234375, 0.07421875],
		[-0.078125, -0.0234375, 0.07421875],
		[-0.046875, 0.0625, 0.0],
		[-0.0390625, 0.0625, -0.0625],
		[0.0390625, 0.0625, -0.0625],
		[0.046875, 0.0625, 0.0],
	],
	f: [
		{ v: [1, 2, 3], type: 'standard', props: { color: 0x000000 } }, // torso bottom
		{ v: [1, 3, 4], type: 'standard', props: { color: 0x000000 } }, // torso bottom
		{ v: [2, 5, 3], type: 'standard', props: { color: 0x000000 } }, // torso bottom
		{ v: [6, 7, 8], type: 'standard', props: { color: 0x000000 } }, // head bottom
		{ v: [6, 8, 9], type: 'standard', props: { color: 0x000000 } }, // head bottom
		{ v: [10, 11, 12], type: 'standard', props: { color: 0xffffff } }, // legs right
		{ v: [10, 12, 13], type: 'standard', props: { color: 0xffffff } }, // legs right
		{ v: [14, 15, 16], type: 'standard', props: { color: 0xffffff } }, // legs left
		{ v: [14, 16, 17], type: 'standard', props: { color: 0xffffff } }, // legs left
		{ v: [13, 12, 15], type: 'standard', props: { color: 0x000000 } }, // legs rear
		{ v: [13, 15, 14], type: 'standard', props: { color: 0x000000 } }, // legs rear
		{ v: [17, 16, 11], type: 'standard', props: { color: 0x000000 } }, // legs front
		{ v: [17, 11, 10], type: 'standard', props: { color: 0x000000 } }, // legs front
		{ v: [3, 18, 19], type: 'standard', props: { color: 0xf0f000 } }, // arm right
		{ v: [3, 19, 4], type: 'standard', props: { color: 0xf0f000 } }, // arm right
		{ v: [1, 20, 21], type: 'standard', props: { color: 0xf0f000 } }, // arm left
		{ v: [1, 21, 2], type: 'standard', props: { color: 0xf0f000 } }, // arm left
		{ v: [4, 19, 20], type: 'standard', props: { color: 0x8080e0 } }, // back
		{ v: [4, 20, 1], type: 'standard', props: { color: 0x8080e0 } }, // back
		{ v: [2, 22, 5], type: 'standard', props: { color: 0x8080e0 } }, // lower front torso
		{ v: [5, 22, 3], type: 'standard', props: { color: 0x8080e0 } }, // lower front torso
		{ v: [2, 21, 22], type: 'standard', props: { color: 0x000000 } }, // upper front torso
		{ v: [3, 22, 18], type: 'standard', props: { color: 0x000000 } }, // upper front torso
		{ v: [21, 23, 22], type: 'standard', props: { color: 0x8080e0 } }, // top front torso
		{ v: [22, 23, 18], type: 'standard', props: { color: 0x8080e0 } }, // top front torso
		{ v: [20, 23, 21], type: 'standard', props: { color: 0xf0f000 } }, // shoulder right
		{ v: [18, 23, 19], type: 'standard', props: { color: 0xf0f000 } }, // shoulder left
		{ v: [19, 23, 20], type: 'standard', props: { color: 0x8080e0 } }, // top back torso
		{ v: [7, 24, 25], type: 'standard', props: { color: 0x000000 } }, // lower head front
		{ v: [7, 25, 8], type: 'standard', props: { color: 0x000000 } }, // lower head front
		{ v: [8, 25, 9], type: 'standard', props: { color: 0x800010 } }, // lower head right
		{ v: [6, 24, 7], type: 'standard', props: { color: 0x800010 } }, // lower head right
		{ v: [25, 26, 27], type: 'standard', props: { color: 0xf0f000 } }, // top head right
		{ v: [25, 27, 9], type: 'standard', props: { color: 0xf0f000 } }, // top head right
		{ v: [6, 28, 29], type: 'standard', props: { color: 0xf0f000 } }, // top head left
		{ v: [6, 29, 24], type: 'standard', props: { color: 0xf0f000 } }, // top head left
		{ v: [9, 27, 28], type: 'standard', props: { color: 0x000000 } }, // head back
		{ v: [9, 28, 6], type: 'standard', props: { color: 0x000000 } }, // head back
		{ v: [29, 28, 27], type: 'standard', props: { color: 0x000000 } }, // head top
		{ v: [29, 27, 26], type: 'standard', props: { color: 0x000000 } }, // head top
		{ v: [24, 29, 26], type: 'standard', props: { color: 0xf0f000 } }, // head front
		{ v: [24, 26, 25], type: 'standard', props: { color: 0xf0f000 } }, // head front
	],
};

const sentry: Model = {
	v: [
		[-0.1328125, -0.875, -0.09765625],
		[-0.1328125, -0.2109375, -0.09765625],
		[0.1328125, -0.2109375, -0.09765625],
		[0.1328125, -0.875, -0.09765625],
		[-0.1328125, -0.875, 0.09765625],
		[-0.2109375, -0.2109375, 0.0],
		[0.2109375, -0.2109375, 0.0],
		[0.1328125, -0.875, 0.09765625],
		[0.05078125, -0.1875, 0.1875],
		[-0.05078125, -0.1875, 0.1875],
		[-0.10546875, -0.0625, -0.078125],
		[0.10546875, -0.0625, -0.078125],
		[0.10546875, -0.0625, 0.078125],
		[-0.10546875, -0.0625, 0.078125],
		[0.06640625, -0.0625, 0.2421875],
		[-0.06640625, -0.0625, 0.2421875],
		[-0.09375, 0.0390625, -0.078125],
		[0.09375, 0.0390625, -0.078125],
		[-0.08984375, 0.0625, 0.09765625],
		[0.08984375, 0.0625, 0.09765625],
		[0.046875, 0.0078125, 0.2421875],
		[-0.046875, 0.0078125, 0.2421875],
	],
	f: [
		{ v: [1, 2, 3], type: 'standard', props: { color: 0x000000 } }, // lower back right
		{ v: [1, 3, 4], type: 'standard', props: { color: 0x000000 } }, // lower back left
		{ v: [5, 6, 1], type: 'standard', props: { color: 0x000000 } }, // side rear right
		{ v: [4, 7, 8], type: 'standard', props: { color: 0x000000 } }, // side rear left
		{ v: [8, 9, 10], type: 'standard', props: { color: 0x000000 } }, // lower front
		{ v: [8, 10, 5], type: 'standard', props: { color: 0x000000 } }, // lower front
		{ v: [1, 6, 2], type: 'standard', props: { color: 0xff0000 } }, // side front right
		{ v: [4, 3, 7], type: 'standard', props: { color: 0xff0000 } }, // side front left
		{ v: [8, 7, 9], type: 'standard', props: { color: 0xff0000 } }, // front side right
		{ v: [5, 10, 6], type: 'standard', props: { color: 0xff0000 } }, // front side left
		{ v: [6, 11, 2], type: 'standard', props: { color: 0xff0000 } }, // upper side right
		{ v: [2, 11, 12], type: 'standard', props: { color: 0xff0000 } }, // upper back
		{ v: [2, 12, 3], type: 'standard', props: { color: 0xff0000 } }, // upper back
		{ v: [3, 12, 7], type: 'standard', props: { color: 0xff0000 } }, // upper side left
		{ v: [7, 13, 9], type: 'standard', props: { color: 0xff0000 } }, // upper front right
		{ v: [9, 13, 14], type: 'standard', props: { color: 0x000000 } }, // upper front
		{ v: [9, 14, 10], type: 'standard', props: { color: 0x000000 } }, // upper front
		{ v: [10, 14, 6], type: 'standard', props: { color: 0xff0000 } }, // upper front left
		{ v: [6, 14, 11], type: 'standard', props: { color: 0x000000 } }, // shoulder right
		{ v: [7, 12, 13], type: 'standard', props: { color: 0x000000 } }, // shoulder left
		{ v: [13, 15, 16], type: 'standard', props: { color: 0xf0f000 } }, // beak bottom
		{ v: [13, 16, 14], type: 'standard', props: { color: 0xf0f000 } }, // beak bottom
		{ v: [11, 17, 18], type: 'standard', props: { color: 0x000000 } }, // head back
		{ v: [11, 18, 12], type: 'standard', props: { color: 0x000000 } }, // head back
		{ v: [14, 19, 17], type: 'standard', props: { color: 0xff0000 } }, // head right
		{ v: [14, 17, 11], type: 'standard', props: { color: 0xff0000 } }, // head right
		{ v: [12, 18, 20], type: 'standard', props: { color: 0xff0000 } }, // head left
		{ v: [12, 20, 13], type: 'standard', props: { color: 0xff0000 } }, // head left
		{ v: [20, 18, 17], type: 'standard', props: { color: 0x000000 } }, // head top
		{ v: [20, 17, 19], type: 'standard', props: { color: 0x000000 } }, // head top
		{ v: [21, 20, 19], type: 'standard', props: { color: 0xf0f000 } }, // beak top
		{ v: [21, 19, 22], type: 'standard', props: { color: 0xf0f000 } }, // beak top
		{ v: [16, 22, 19], type: 'standard', props: { color: 0xf0f000 } }, // beak right
		{ v: [16, 19, 14], type: 'standard', props: { color: 0xf0f000 } }, // beak right
		{ v: [13, 20, 21], type: 'standard', props: { color: 0xf0f000 } }, // beak left
		{ v: [13, 21, 15], type: 'standard', props: { color: 0xf0f000 } }, // beak left
		{ v: [15, 21, 22], type: 'standard', props: { color: 0xf0f000 } }, // beak front
		{ v: [15, 22, 16], type: 'standard', props: { color: 0xf0f000 } }, // beak front
	],
};

const models: Record<string, Model> = {
	sentinel,
	tree,
	pedestal,
	boulder,
	synthoid,
	sentry,
};

export function getObject(name: string, scale: number = 1) {
	const model = models[name];
	if (!model) return null;

	// TODO: find lowest point and shift all so that it's based at 0

	const vs: THREE.Vector3[] = model.v.map(v => new THREE.Vector3(v[0] * scale, v[1] * scale, v[2] * scale));

	const group = new THREE.Group();
	model.f.forEach(f => {
		let material;
		if (f.type === 'standard') {
			material = new THREE.MeshBasicMaterial(f.props);
		} else if (f.type === 'phong') {
			new THREE.MeshPhongMaterial(f.props);
		}
		const geometry = new THREE.BufferGeometry().setFromPoints([vs[f.v[0] - 1], vs[f.v[1] - 1], vs[f.v[2] - 1]]);
		const mesh = new THREE.Mesh(geometry, material);
		group.add(mesh);
	});
	return group;
}
