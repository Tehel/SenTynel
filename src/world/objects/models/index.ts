import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshPhongMaterial, Vector3 } from 'three';
import { GameObjType } from '../../terrain';
import { sentinel } from './sentinel';
import { tree } from './tree';
import { pedestal } from './pedestal';
import { boulder } from './boulder';
import { synthoid } from './synthoid';
import { sentry } from './sentry';
import { meanie } from './meanie';

interface Face {
	v: number[];
	color: number;
}

interface Model {
	v: number[][];
	f: Face[];
}

const models: Record<GameObjType, Model> = {
	[GameObjType.SENTINEL]: sentinel,
	[GameObjType.SENTRY]: sentry,
	[GameObjType.MEANIE]: meanie,
	[GameObjType.PEDESTAL]: pedestal,
	[GameObjType.TREE]: tree,
	[GameObjType.SYNTHOID]: synthoid,
	[GameObjType.BOULDER]: boulder,
};

export interface ModelOptions {
	scale?: number;
	color1?: number;
	color2?: number;
}

// Fade-mode constants — kept in sync with the GLSL switch in the fragment patch and
// with the mode setters in base.ts. Re-export so base.ts can reference them by name.
export const FADE_MODE_READY = 0;
export const FADE_MODE_PER_VERTEX_IN = 1;
export const FADE_MODE_PER_VERTEX_OUT = 2;
export const FADE_MODE_UNIFORM_IN = 3;
export const FADE_MODE_UNIFORM_OUT = 4;

// FADE_SLICE = 0.2: each face's reveal/hide transition spans 20% of the total animation
// duration; with face ranks spread linearly over [0, 1-FADE_SLICE] = [0, 0.8], the
// animation takes the full 100% to complete and adjacent faces overlap by FADE_SLICE.
const FADE_SLICE = 0.2;
const FADE_RANGE = 1.0 - FADE_SLICE;

export interface FadeUniforms {
	fadeProgress: { value: number };
	fadeMode: { value: number };
}

// Build a single merged Mesh per object: one BufferGeometry holding all faces' vertices,
// per-vertex `color` (face colour repeated on each of the face's 3 vertices) and
// `fadeOffset` (the face's rank by max-Y, normalised to [0, 1]) attributes, and one
// MeshPhongMaterial whose shader is patched (via onBeforeCompile) to drive a per-vertex
// alpha based on fadeOffset + a fadeMode/fadeProgress uniform pair. The patch supports
// both the original 'fade' style (bottom-up reveal / top-down absorb) via PER_VERTEX_IN
// / PER_VERTEX_OUT modes, and the 'dissolve' style (uniform body fade) via UNIFORM_IN /
// UNIFORM_OUT. Each material owns its own uniforms (uncached, so per-object fade state
// doesn't bleed across objects).
export function getObject(type: GameObjType, options?: ModelOptions): Mesh {
	const model = models[type];
	if (!model) throw new Error(`No model registered for GameObjType ${GameObjType[type]} (${type})`);

	const sc = options?.scale || 1;
	const vs: Vector3[] = model.v.map(v => new Vector3(v[0] * sc, v[1] * sc, v[2] * sc));

	const n = model.f.length;
	const positions = new Float32Array(n * 9); // 3 vertices × 3 components
	const colors = new Float32Array(n * 9);
	const fadeOffsets = new Float32Array(n * 3);

	// Per-face highest-Y → rank → fadeOffset in [0, 1]. Same idea as the previous
	// per-face sort: face with the lowest top fades in first / out last.
	const faceMaxY = new Array<number>(n);
	for (let i = 0; i < n; i++) {
		const f = model.f[i];
		let maxY = -Infinity;
		for (const vi of f.v) {
			const y = vs[vi - 1].y;
			if (y > maxY) maxY = y;
		}
		faceMaxY[i] = maxY;
	}
	const sortedFaceIdx = Array.from({ length: n }, (_, i) => i).sort((a, b) => faceMaxY[a] - faceMaxY[b]);
	const facePerRank = new Float32Array(n);
	for (let rank = 0; rank < n; rank++) {
		facePerRank[sortedFaceIdx[rank]] = n === 1 ? 0 : rank / (n - 1);
	}

	for (let i = 0; i < n; i++) {
		const f = model.f[i];
		const colorVal =
			f.color === -1 ? (options?.color1 ?? 0xff00ff)
			: f.color === -2 ? (options?.color2 ?? 0xff8000)
			: f.color;
		const cr = ((colorVal >> 16) & 0xff) / 255;
		const cg = ((colorVal >> 8) & 0xff) / 255;
		const cb = (colorVal & 0xff) / 255;
		const fo = facePerRank[i];

		for (let j = 0; j < 3; j++) {
			const v = vs[f.v[j] - 1];
			const idx9 = i * 9 + j * 3;
			positions[idx9] = v.x;
			positions[idx9 + 1] = v.y;
			positions[idx9 + 2] = v.z;
			colors[idx9] = cr;
			colors[idx9 + 1] = cg;
			colors[idx9 + 2] = cb;
			fadeOffsets[i * 3 + j] = fo;
		}
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setAttribute('color', new BufferAttribute(colors, 3));
	geometry.setAttribute('fadeOffset', new BufferAttribute(fadeOffsets, 1));

	// Per-material uniforms — referenced from base.ts via material.userData.uniforms.
	const uniforms: FadeUniforms = {
		fadeProgress: { value: 0 },
		fadeMode: { value: FADE_MODE_READY },
	};

	// transparent stays false until a fade animation actually needs it; opacity stays
	// at 1 so date=0 (level-start) spawns are visible immediately. base.ts flips
	// transparent → true at the start of any fade-style or dissolve-style animation
	// and back to false when the spawn fade completes (absorbs end with the object
	// removed, so no reset needed).
	const material = new MeshPhongMaterial({
		vertexColors: true,
		flatShading: true,
		specular: 0x404040,
		transparent: false,
		opacity: 1,
		side: DoubleSide,
	});
	material.userData.uniforms = uniforms;

	material.onBeforeCompile = shader => {
		shader.uniforms.fadeProgress = uniforms.fadeProgress;
		shader.uniforms.fadeMode = uniforms.fadeMode;

		shader.vertexShader =
			`attribute float fadeOffset;
			varying float vFadeOffset;
			` +
			shader.vertexShader.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vFadeOffset = fadeOffset;`
			);

		shader.fragmentShader =
			`varying float vFadeOffset;
			uniform float fadeProgress;
			uniform int fadeMode;
			` +
			shader.fragmentShader.replace(
				'#include <dithering_fragment>',
				`#include <dithering_fragment>
				float fadeAlpha;
				if (fadeMode == ${FADE_MODE_READY}) {
					fadeAlpha = 1.0;
				} else if (fadeMode == ${FADE_MODE_PER_VERTEX_IN}) {
					float startV = vFadeOffset * ${FADE_RANGE.toFixed(3)};
					fadeAlpha = clamp((fadeProgress - startV) / ${FADE_SLICE.toFixed(3)}, 0.0, 1.0);
				} else if (fadeMode == ${FADE_MODE_PER_VERTEX_OUT}) {
					float startV = (1.0 - vFadeOffset) * ${FADE_RANGE.toFixed(3)};
					fadeAlpha = 1.0 - clamp((fadeProgress - startV) / ${FADE_SLICE.toFixed(3)}, 0.0, 1.0);
				} else if (fadeMode == ${FADE_MODE_UNIFORM_IN}) {
					fadeAlpha = fadeProgress;
				} else {
					fadeAlpha = 1.0 - fadeProgress;
				}
				gl_FragColor.a *= fadeAlpha;`
			);
	};

	return new Mesh(geometry, material);
}
