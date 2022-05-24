import * as THREE from 'three';
import { GameObjType } from './sentland';

interface Face {
	v: number[];
	color: number;
}

interface Model {
	v: number[][];
	f: Face[];
}

const sentinel: Model = {
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

const tree: Model = {
	v: [
		[0, 0.3125, 0.40625],
		[-0.2890625, 0.3125, 0.2890625],
		[-0.40625, 0.3125, 0],
		[0.2890625, 0.3125, 0.2890625],
		[-0.2890625, 0.3125, -0.2890625],
		[0.40625, 0.3125, 0],
		[0, 0.3125, -0.40625],
		[0.2890625, 0.3125, -0.2890625],
		[0.06640625, 0, 0.06640625],
		[0.06640625, 0.3125, 0.06640625],
		[-0.06640625, 0.3125, 0.06640625],
		[-0.06640625, 0, 0.06640625],
		[0.06640625, 0, -0.06640625],
		[0.06640625, 0.3125, -0.06640625],
		[-0.06640625, 0.3125, -0.06640625],
		[-0.06640625, 0, -0.06640625],
		[0, 1.8125, 0],
	],
	f: [
		{ v: [1, 2, 3], color: 0x280a00 }, // bottom
		{ v: [1, 3, 4], color: 0x280a00 }, // bottom
		{ v: [4, 3, 5], color: 0x280a00 }, // bottom
		{ v: [4, 5, 6], color: 0x280a00 }, // bottom
		{ v: [6, 5, 7], color: 0x280a00 }, // bottom
		{ v: [6, 7, 8], color: 0x280a00 }, // bottom
		{ v: [9, 10, 11], color: 0x671b00 }, // trunk
		{ v: [9, 11, 12], color: 0x671b00 }, // trunk
		{ v: [13, 14, 10], color: 0x3f0f00 }, // trunk
		{ v: [13, 10, 9], color: 0x3f0f00 }, // trunk
		{ v: [12, 11, 15], color: 0x3f0f00 }, // trunk
		{ v: [12, 15, 16], color: 0x3f0f00 }, // trunk
		{ v: [16, 15, 14], color: 0x671b00 }, // trunk
		{ v: [16, 14, 13], color: 0x671b00 }, // trunk
		{ v: [1, 17, 2], color: 0x2eb032 }, // leafs
		{ v: [4, 17, 1], color: 0x006204 }, // leafs
		{ v: [6, 17, 4], color: 0x2eb032 }, // leafs
		{ v: [8, 17, 6], color: 0x006204 }, // leafs
		{ v: [7, 17, 8], color: 0x2eb032 }, // leafs
		{ v: [5, 17, 7], color: 0x006204 }, // leafs
		{ v: [3, 17, 5], color: 0x2eb032 }, // leafs
		{ v: [2, 17, 3], color: 0x006204 }, // leafs
	],
};

const pedestal: Model = {
	v: [
		[0.5, 0, 0.5],
		[0.265625, 1, 0.5],
		[-0.265625, 1, 0.5],
		[-0.5, 0, 0.5],
		[0.5, 0, -0.5],
		[0.5, 1, -0.265625],
		[0.5, 1, 0.265625],
		[-0.5, 0, -0.5],
		[-0.265625, 1, -0.5],
		[0.265625, 1, -0.5],
		[-0.5, 1, 0.265625],
		[-0.5, 1, -0.265625],
	],
	f: [
		{ v: [1, 2, 3], color: 0x000000 }, // side
		{ v: [1, 3, 4], color: 0x000000 }, // side
		{ v: [5, 6, 7], color: -1 }, // side
		{ v: [5, 7, 1], color: -1 }, // side
		{ v: [8, 9, 10], color: 0x000000 }, // side
		{ v: [8, 10, 5], color: 0x000000 }, // side
		{ v: [4, 11, 12], color: -1 }, // side
		{ v: [4, 12, 8], color: -1 }, // side
		{ v: [4, 3, 11], color: 0xf0f000 }, // diamonds
		{ v: [1, 7, 2], color: 0xf0f000 }, // diamonds
		{ v: [5, 10, 6], color: 0xf0f000 }, // diamonds
		{ v: [8, 12, 9], color: 0xf0f000 }, // diamonds
		{ v: [2, 7, 6], color: -2 }, // top
		{ v: [2, 6, 10], color: -2 }, // top
		{ v: [2, 10, 9], color: -2 }, // top
		{ v: [2, 9, 3], color: -2 }, // top
		{ v: [3, 9, 12], color: -2 }, // top
		{ v: [3, 12, 11], color: -2 }, // top
	],
};

const boulder: Model = {
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

const synthoid: Model = {
	v: [
		[0.1640625, 0.4375, -0.09375],
		[0.15625, 0.4375, 0.04296875],
		[-0.15625, 0.4375, 0.04296875],
		[-0.1640625, 0.4375, -0.09375],
		[0, 0.4375, 0.125],
		[0.07421875, 0.7890625, -0.0859375],
		[0.03515625, 0.7890625, 0.06640625],
		[-0.03515625, 0.7890625, 0.06640625],
		[-0.07421875, 0.7890625, -0.0859375],
		[-0.07421875, 0, 0.02734375],
		[-0.09765625, 0.4375, 0.0703125],
		[-0.1171875, 0.4375, -0.07421875],
		[-0.078125, 0, -0.07421875],
		[0.078125, 0, -0.07421875],
		[0.1171875, 0.4375, -0.07421875],
		[0.09765625, 0.4375, 0.0703125],
		[0.07421875, 0, 0.02734375],
		[-0.203125, 0.734375, 0.0234375],
		[-0.19921875, 0.734375, -0.09375],
		[0.19921875, 0.734375, -0.09375],
		[0.203125, 0.734375, 0.0234375],
		[0, 0.7109375, 0.125],
		[0, 0.796875, 0],
		[0.078125, 0.8515625, 0.07421875],
		[-0.078125, 0.8515625, 0.07421875],
		[-0.046875, 0.9375, 0],
		[-0.0390625, 0.9375, -0.0625],
		[0.0390625, 0.9375, -0.0625],
		[0.046875, 0.9375, 0],
	],
	f: [
		{ v: [1, 2, 3], color: 0x000000 }, // torso bottom
		{ v: [1, 3, 4], color: 0x000000 }, // torso bottom
		{ v: [2, 5, 3], color: 0x000000 }, // torso bottom
		{ v: [6, 7, 8], color: 0x000000 }, // head bottom
		{ v: [6, 8, 9], color: 0x000000 }, // head bottom
		{ v: [10, 11, 12], color: 0xffffff }, // legs right
		{ v: [10, 12, 13], color: 0xffffff }, // legs right
		{ v: [14, 15, 16], color: 0xffffff }, // legs left
		{ v: [14, 16, 17], color: 0xffffff }, // legs left
		{ v: [13, 12, 15], color: 0x000000 }, // legs rear
		{ v: [13, 15, 14], color: 0x000000 }, // legs rear
		{ v: [17, 16, 11], color: 0x000000 }, // legs front
		{ v: [17, 11, 10], color: 0x000000 }, // legs front
		{ v: [3, 18, 19], color: 0xf0f000 }, // arm right
		{ v: [3, 19, 4], color: 0xf0f000 }, // arm right
		{ v: [1, 20, 21], color: 0xf0f000 }, // arm left
		{ v: [1, 21, 2], color: 0xf0f000 }, // arm left
		{ v: [4, 19, 20], color: 0x8080e0 }, // back
		{ v: [4, 20, 1], color: 0x8080e0 }, // back
		{ v: [2, 22, 5], color: 0x8080e0 }, // lower front torso
		{ v: [5, 22, 3], color: 0x8080e0 }, // lower front torso
		{ v: [2, 21, 22], color: 0x000000 }, // upper front torso
		{ v: [3, 22, 18], color: 0x000000 }, // upper front torso
		{ v: [21, 23, 22], color: 0x8080e0 }, // top front torso
		{ v: [22, 23, 18], color: 0x8080e0 }, // top front torso
		{ v: [20, 23, 21], color: 0xf0f000 }, // shoulder right
		{ v: [18, 23, 19], color: 0xf0f000 }, // shoulder left
		{ v: [19, 23, 20], color: 0x8080e0 }, // top back torso
		{ v: [7, 24, 25], color: 0x000000 }, // lower head front
		{ v: [7, 25, 8], color: 0x000000 }, // lower head front
		{ v: [8, 25, 9], color: 0x800010 }, // lower head right
		{ v: [6, 24, 7], color: 0x800010 }, // lower head right
		{ v: [25, 26, 27], color: 0xf0f000 }, // top head right
		{ v: [25, 27, 9], color: 0xf0f000 }, // top head right
		{ v: [6, 28, 29], color: 0xf0f000 }, // top head left
		{ v: [6, 29, 24], color: 0xf0f000 }, // top head left
		{ v: [9, 27, 28], color: 0x000000 }, // head back
		{ v: [9, 28, 6], color: 0x000000 }, // head back
		{ v: [29, 28, 27], color: 0x000000 }, // head top
		{ v: [29, 27, 26], color: 0x000000 }, // head top
		{ v: [24, 29, 26], color: 0xf0f000 }, // head front
		{ v: [24, 26, 25], color: 0xf0f000 }, // head front
	],
};

const sentry: Model = {
	v: [
		[-0.1328125, 0, -0.09765625],
		[-0.1328125, 0.6640625, -0.09765625],
		[0.1328125, 0.6640625, -0.09765625],
		[0.1328125, 0, -0.09765625],
		[-0.1328125, 0, 0.09765625],
		[-0.2109375, 0.6640625, 0],
		[0.2109375, 0.6640625, 0],
		[0.1328125, 0, 0.09765625],
		[0.05078125, 0.6875, 0.1875],
		[-0.05078125, 0.6875, 0.1875],
		[-0.10546875, 0.8125, -0.078125],
		[0.10546875, 0.8125, -0.078125],
		[0.10546875, 0.8125, 0.078125],
		[-0.10546875, 0.8125, 0.078125],
		[0.06640625, 0.8125, 0.2421875],
		[-0.06640625, 0.8125, 0.2421875],
		[-0.09375, 0.9140625, -0.078125],
		[0.09375, 0.9140625, -0.078125],
		[-0.08984375, 0.9375, 0.09765625],
		[0.08984375, 0.9375, 0.09765625],
		[0.046875, 0.8828125, 0.2421875],
		[-0.046875, 0.8828125, 0.2421875],
	],
	f: [
		{ v: [1, 2, 3], color: 0x000000 }, // lower back right
		{ v: [1, 3, 4], color: 0x000000 }, // lower back left
		{ v: [5, 6, 1], color: 0x000000 }, // side rear right
		{ v: [4, 7, 8], color: 0x000000 }, // side rear left
		{ v: [8, 9, 10], color: 0x000000 }, // lower front
		{ v: [8, 10, 5], color: 0x000000 }, // lower front
		{ v: [1, 6, 2], color: 0xff0000 }, // side front right
		{ v: [4, 3, 7], color: 0xff0000 }, // side front left
		{ v: [8, 7, 9], color: 0xff0000 }, // front side right
		{ v: [5, 10, 6], color: 0xff0000 }, // front side left
		{ v: [6, 11, 2], color: 0xff0000 }, // upper side right
		{ v: [2, 11, 12], color: 0xff0000 }, // upper back
		{ v: [2, 12, 3], color: 0xff0000 }, // upper back
		{ v: [3, 12, 7], color: 0xff0000 }, // upper side left
		{ v: [7, 13, 9], color: 0xff0000 }, // upper front right
		{ v: [9, 13, 14], color: 0x000000 }, // upper front
		{ v: [9, 14, 10], color: 0x000000 }, // upper front
		{ v: [10, 14, 6], color: 0xff0000 }, // upper front left
		{ v: [6, 14, 11], color: 0x000000 }, // shoulder right
		{ v: [7, 12, 13], color: 0x000000 }, // shoulder left
		{ v: [13, 15, 16], color: 0x000000 }, // beak bottom
		{ v: [13, 16, 14], color: 0x000000 }, // beak bottom
		{ v: [11, 17, 18], color: 0x000000 }, // head back
		{ v: [11, 18, 12], color: 0x000000 }, // head back
		{ v: [14, 19, 17], color: 0xff0000 }, // head right
		{ v: [14, 17, 11], color: 0xff0000 }, // head right
		{ v: [12, 18, 20], color: 0xff0000 }, // head left
		{ v: [12, 20, 13], color: 0xff0000 }, // head left
		{ v: [20, 18, 17], color: 0x000000 }, // head top
		{ v: [20, 17, 19], color: 0x000000 }, // head top
		{ v: [21, 20, 19], color: 0xf0f000 }, // beak top
		{ v: [21, 19, 22], color: 0xf0f000 }, // beak top
		{ v: [16, 22, 19], color: 0xf0f000 }, // beak right
		{ v: [16, 19, 14], color: 0xf0f000 }, // beak right
		{ v: [13, 20, 21], color: 0xf0f000 }, // beak left
		{ v: [13, 21, 15], color: 0xf0f000 }, // beak left
		{ v: [15, 21, 22], color: 0xf0f000 }, // beak front
		{ v: [15, 22, 16], color: 0xf0f000 }, // beak front
	],
};

const meanie: Model = {
	v: [
		[0.03125, 0.796875, 0.03515625],
		[0.05078125, 0.765625, 0.203125],
		[-0.05078125, 0.765625, 0.203125],
		[-0.03125, 0.796875, 0.03515625],
		[0, 0, 0.203125],
		[-0.0546875, 0.40625, -0.15234375],
		[-0.21875, 0, -0.15234375],
		[0.21875, 0, -0.15234375],
		[0.0546875, 0.40625, -0.15234375],
		[0, 0.40625, -0.1015625],
		[-0.07421875, 0.8828125, -0.05078125],
		[0.07421875, 0.8828125, -0.05078125],
		[-0.15625, 0.8125, 0.08984375],
		[0.15625, 0.8125, 0.08984375],
		[-0.02734375, 0.8359375, 0.2265625],
		[0.02734375, 0.8359375, 0.2265625],
		[-0.0703125, 0.921875, 0.11328125],
		[0.0703125, 0.921875, 0.11328125],
	],
	f: [
		{ v: [1, 2, 3], color: 0x000000 }, // head bottom
		{ v: [1, 3, 4], color: 0x000000 }, // head bottom
		{ v: [5, 6, 7], color: 0x33251c }, // foot right
		{ v: [8, 9, 5], color: 0x33251c }, // foot left
		{ v: [5, 9, 10], color: 0x006204 }, // foot front
		{ v: [5, 10, 6], color: 0x006204 }, // foot front
		{ v: [7, 6, 9], color: 0x000000 }, // foot back
		{ v: [7, 9, 8], color: 0x000000 }, // foot back
		{ v: [6, 4, 11], color: 0x006204 }, // neck right
		{ v: [9, 12, 1], color: 0x006204 }, // neck left
		{ v: [6, 11, 12], color: 0x006204 }, // neck back
		{ v: [6, 12, 9], color: 0x006204 }, // neck back
		{ v: [10, 4, 6], color: 0x000000 }, // neck front right
		{ v: [9, 1, 10], color: 0x000000 }, // neck front left
		{ v: [10, 1, 4], color: 0xffffff }, // neck front
		{ v: [3, 13, 4], color: 0xffffff }, // head bottom right
		{ v: [1, 14, 2], color: 0xffffff }, // head bottom left
		{ v: [3, 15, 13], color: 0x000000 }, // head front right
		{ v: [2, 14, 16], color: 0x000000 }, // head front left
		{ v: [2, 16, 15], color: 0xf0f000 }, // head front
		{ v: [2, 15, 3], color: 0xf0f000 }, // head front
		{ v: [4, 13, 11], color: 0xffffff }, // head back right
		{ v: [1, 12, 14], color: 0xffffff }, // head back left
		{ v: [13, 17, 11], color: 0x000000 }, // head back top right
		{ v: [12, 18, 14], color: 0x000000 }, // head back top left
		{ v: [13, 15, 17], color: 0xf0f000 }, // head front right
		{ v: [14, 18, 16], color: 0xf0f000 }, // head front left
		{ v: [11, 17, 18], color: 0x000000 }, // head top
		{ v: [11, 18, 12], color: 0x000000 }, // head top
		{ v: [16, 18, 17], color: 0x000000 }, // head top front
		{ v: [16, 17, 15], color: 0x000000 }, // head top front
	],
};

const models: Record<GameObjType, Model> = {
	[GameObjType.SENTINEL]: sentinel,
	[GameObjType.SENTRY]: sentry,
	[GameObjType.MEANIE]: meanie,
	[GameObjType.PEDESTAL]: pedestal,
	[GameObjType.TREE]: tree,
	[GameObjType.SYNTHOID]: synthoid,
	[GameObjType.BOULDER]: boulder,
};

export function getObject(type: GameObjType, options: { scale?: number; color1?: number; color2?: number }) {
	const model = models[type];
	if (!model) return null;

	const sc = options.scale || 1;
	const vs: THREE.Vector3[] = model.v.map(v => new THREE.Vector3(v[0] * sc, v[1] * sc, v[2] * sc));

	const group = new THREE.Group();
	model.f.forEach(f => {
		const color =
			f.color === -1 ? options.color1 || 0xff00ff : f.color === -2 ? options.color2 || 0xff8000 : f.color;
		const material = new THREE.MeshPhongMaterial({
			color,
			flatShading: true,
			specular: 0x404040,
		});
		const geometry = new THREE.BufferGeometry().setFromPoints([vs[f.v[0] - 1], vs[f.v[1] - 1], vs[f.v[2] - 1]]);
		const mesh = new THREE.Mesh(geometry, material);
		group.add(mesh);
	});
	return group;
}
