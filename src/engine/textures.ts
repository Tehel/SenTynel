import { LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three';

/*
 Terrain texture loading. Deliberately the same shape as engine/skybox.ts, for the same reasons
 spelled out there: a module-level cache so load + decode + GPU upload happens once per file and
 is reused across every scene rebuild, and NO registration with the per-build Disposer, because
 the cache is meant to outlive scene lifetimes. Re-decoding a texture on every level switch would
 be pure waste — the eight themes share one texture set and only the tint differs.

 It also has to fail the way the skybox fails. src/engine/bot.harness.test.ts builds real scenes
 in Node, where `Image` does not exist, and the skybox load throws there on every one of the
 hundred landscapes a rules-check plays — harmlessly, because the rejection is caught and the
 sweep never touches a pixel. Anything here that threw synchronously, or left an unhandled
 rejection, would take the referee down with it.
*/

const cache = new Map<string, Promise<Texture>>();

export type TerrainSurface = 'grass' | 'rock' | 'metal' | 'organic' | 'sand' | 'concrete' | 'wood';

// One world tile is one world unit; the textures are authored at 64 px per tile and 512 px
// square (utils/gen-textures.py), so a UV of worldXZ / TEXTURE_TILES lands exactly on that
// density with no per-tile repeat to give the tiling away.
export const TEXTURE_TILES = 8;

function load(file: string, baseUrl: string, srgb: boolean): Promise<Texture> {
	const key = file;
	const hit = cache.get(key);
	if (hit) return hit;
	const promise = new Promise<Texture>((resolve, reject) => {
		// Guard rather than assume: Node has no Image, and this runs there under the bot harness.
		if (typeof Image === 'undefined') {
			reject(new Error('textures: no Image in this environment'));
			return;
		}
		const img = new Image();
		img.onload = () => {
			const tex = new Texture(img);
			// Albedo carries colour and must be decoded from sRGB; a normal map carries vectors
			// and must not be — decoding it would bend every normal toward the surface.
			tex.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
			tex.wrapS = RepeatWrapping;
			tex.wrapT = RepeatWrapping;
			tex.anisotropy = 8;
			tex.needsUpdate = true;
			resolve(tex);
		};
		img.onerror = () => reject(new Error(`textures: failed to load ${file}`));
		img.src = `${baseUrl}tex/${file}`;
	});
	cache.set(key, promise);
	return promise;
}

export interface SurfaceMaps {
	albedo: Texture;
	normal: Texture;
}

export function loadSurface(surface: TerrainSurface, baseUrl: string): Promise<SurfaceMaps> {
	return Promise.all([
		load(`${surface}_a.webp`, baseUrl, true),
		load(`${surface}_n.webp`, baseUrl, false),
	]).then(([albedo, normal]) => ({ albedo, normal }));
}
