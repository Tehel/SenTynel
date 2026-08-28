import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, MeshPhongMaterial, Vector3 } from 'three';
import { GameObjType } from '../../terrain';
import { sentinel } from './sentinel';
import { tree } from './tree';
import { pedestal } from './pedestal';
import { boulder } from './boulder';
import { synthoid } from './synthoid';
import { sentry } from './sentry';
import { meanie } from './meanie';
import { sentinelRobot } from './sentinelRobot';
import { sentryRobot } from './sentryRobot';
/*
 The frozen originals that answer every raycast — see ./legacy/index.ts. Imported from their own
 files, NOT aliased to `models`: the first attempt wrote `const legacyModels = models`, which is
 the same object, so regenerating the drawn models silently replaced the occluders too and moved
 24 of 100 landscapes. utils/rules-check.sh caught it; the alias is why separate files exist.
*/
import { legacyModels } from './legacy/index';

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

export type ModelStyle = 'classic' | 'enhanced';

/*
 Which set of watchers to draw. Both were designed to the same envelope and both read well; they
 are simply different games to look at — 'birds' is a creature perched watching you, 'robots' the
 cowled machine of the first redraw. Only the Sentinel and the Sentry differ; the other five models
 are shared, so the family only ever swaps two meshes.
*/
export type ModelFamily = 'birds' | 'robots';

const ROBOTIC: Partial<Record<GameObjType, Model>> = {
	[GameObjType.SENTINEL]: sentinelRobot,
	[GameObjType.SENTRY]: sentryRobot,
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
/*
 The layer the occlusion proxies live on. Cameras render layer 0 only by default, so anything put
 here is invisible for free — no camera change needed — while raycasters that call
 layers.enableAll() still see it. See getOccluder below.
*/
export const LAYER_OCCLUDER = 1;

/*
 World units spanned by one repeat of a model's detail texture. Smaller than the terrain's
 TEXTURE_TILES (8) because a synthoid is under half a unit across: at the terrain's density a
 whole model would sample a few pixels of one tile and come out as flat as it started.
*/
const MODEL_UV_WORLD_SCALE = 1.5;

/*
 The shape that answers the RULES, as opposed to the one that gets drawn.

 Model silhouettes are not decoration in this game. engine/visibility.ts raycasts real triangles,
 engine/picker.ts needs the crosshair to hit one, and engine/watcher.ts reads a synthoid's own
 bounding box to decide whether its HEAD is visible — the rule that makes the Meanie mechanic
 reachable at all (RULES-FIDELITY.md C9). So a prettier model with a different outline is a rules
 change wearing a costume.

 The fix is to split the two. Every GameObject renders a detailed mesh flagged skipRaycast, and
 carries this untextured, uncoloured copy of the ORIGINAL low-poly shape as a child on
 LAYER_OCCLUDER: never rendered, always raycast. The bot sweep then proves the look changed and
 the game did not — see utils/rules-check.sh.

 It is the same principle ARCHITECTURE.md already states for particle bursts and cone overlays —
 "cosmetic geometry must not answer a rules question" — with the roles made explicit rather than
 left to whichever mesh happened to exist.
*/
export function getOccluder(type: GameObjType): Mesh {
	const model = legacyModels[type];
	if (!model) throw new Error(`No occluder registered for GameObjType ${GameObjType[type]} (${type})`);
	const n = model.f.length;
	const positions = new Float32Array(n * 9);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < 3; j++) {
			const v = model.v[model.f[i].v[j] - 1];
			const idx = i * 9 + j * 3;
			positions[idx] = v[0];
			positions[idx + 1] = v[1];
			positions[idx + 2] = v[2];
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	// DoubleSide matches the rendered models, so the occluder blocks from inside too — which is
	// what the player's own hidden body relies on being skipped by the `visible` test rather than
	// by facing.
	const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
	mesh.layers.set(LAYER_OCCLUDER);
	mesh.userData.isOccluder = true;
	return mesh;
}

export function getObject(
	type: GameObjType,
	options?: ModelOptions,
	style: ModelStyle = 'enhanced',
	family: ModelFamily = 'birds'
): Mesh {
	/*
	 'classic' draws the frozen originals — the same data the occluders use, so the two coincide
	 exactly in that mode and the game looks as it always did. The family only applies to the
	 redrawn set, and only to the two watchers; everything else falls through to `models`.
	*/
	const model =
		style === 'classic' ? legacyModels[type]
		: (family === 'robots' ? ROBOTIC[type] : undefined) ?? models[type];
	if (!model) throw new Error(`No model registered for GameObjType ${GameObjType[type]} (${type})`);

	const sc = options?.scale || 1;
	const vs: Vector3[] = model.v.map(v => new Vector3(v[0] * sc, v[1] * sc, v[2] * sc));

	const n = model.f.length;
	const positions = new Float32Array(n * 9); // 3 vertices × 3 components
	const colors = new Float32Array(n * 9);
	const fadeOffsets = new Float32Array(n * 3);
	const uvs = new Float32Array(n * 6);

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

		/*
		 Per-face planar UVs, projected along the face's own dominant axis.

		 Models carry no UVs of their own — they are triangle soup with a flat colour each — so the
		 detail texture needs one generated. Projecting each face separately is exactly right here:
		 every face IS flat, so there is no distortion within one, and because faces never share
		 vertices (the model is expanded per face so each stays flat-shaded) there is no seam to
		 reconcile between them either.

		 The scale is in WORLD units, matching the terrain's own UVs, so the grain on a boulder is
		 the same size as the grain on the ground it sits on. That is the whole point: untextured
		 objects on textured ground read as stickers.
		*/
		const p0 = vs[f.v[0] - 1], p1 = vs[f.v[1] - 1], p2 = vs[f.v[2] - 1];
		const nx = Math.abs((p1.y - p0.y) * (p2.z - p0.z) - (p1.z - p0.z) * (p2.y - p0.y));
		const ny = Math.abs((p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z));
		const nz = Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x));
		const axis = nx > ny && nx > nz ? 0 : ny > nz ? 1 : 2;

		for (let j = 0; j < 3; j++) {
			const v = vs[f.v[j] - 1];
			const idx9 = i * 9 + j * 3;
			const u = axis === 0 ? v.z : v.x;
			const w = axis === 1 ? v.z : v.y;
			uvs[i * 6 + j * 2] = u / MODEL_UV_WORLD_SCALE;
			uvs[i * 6 + j * 2 + 1] = w / MODEL_UV_WORLD_SCALE;
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
	geometry.setAttribute('uv', new BufferAttribute(uvs, 2));

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
