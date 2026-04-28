import { CubeTexture, EquirectangularReflectionMapping, SRGBColorSpace, Texture } from 'three';

// Module-level cache: load + decode + GPU-upload happens once per file, then the resulting
// texture is reused across every scene rebuild. Intentionally NOT registered with the
// per-build Disposer — the cache outlives scene lifetimes by design (themes share their
// skyboxes, and reloading on every level switch would re-decode the bitmap and re-upload
// the texture for nothing).
const cache = new Map<string, Promise<CubeTexture | Texture>>();

export function loadSkybox(file: string, baseUrl: string): Promise<CubeTexture | Texture> {
	const hit = cache.get(file);
	if (hit) return hit;
	const promise = loadEquirect(`${baseUrl}${encodeURI(file)}`);
	cache.set(file, promise);
	return promise;
}

// Equirectangular ("sphere") format: a single 2:1 panorama. Three.js's WebGLBackground
// renders it as a sphere when scene.background is a Texture with EquirectangularReflectionMapping.
// Dispatches by file extension: HDR formats (.exr, .hdr) carry linear high-dynamic-range
// data and need their dedicated loaders (which set FloatType / HalfFloatType + the
// linear color space themselves). LDR formats (png, jpg, webp) go through the standard
// Image → Texture path with sRGB color space.
function loadEquirect(url: string): Promise<Texture> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const tex = new Texture(img);
			tex.mapping = EquirectangularReflectionMapping;
			tex.colorSpace = SRGBColorSpace;
			tex.needsUpdate = true;
			resolve(tex);
		};
		img.onerror = () => reject(new Error(`skybox: failed to load ${url}`));
		img.src = url;
	});
}
