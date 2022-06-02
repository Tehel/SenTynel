<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { GameObject, Boulder, Synthoid, Tree, Sentinel, Meanie, Sentry, Pedestal } from './GameObject';

	import { GameObjType, generateLevel, Level, rng256 } from './sentland';

	export let levelId: number;

	// parameters
	let dim = 0x20;
	let smooths = 2;
	let despikes = 2;
	let showSettings = false;
	let showPosition = false;
	let showGrid = false;
	let showSurfaces = true;
	let showAxis = false;

	// movement is only on XY plane. direction = 0 is east: vector (1, 0, 0)
	let posX = 0;
	let posY = 0;
	let posZ = 100;
	let direction = Math.PI / 2;
	let vertical = 0;
	const moveSpeed = 0.003;
	let map: number[];

	let cameraFov = 60;
	const near = 0.01;
	const far = 2000;

	let viewWidth: number = 0;
	let viewHeight: number = 0;

	let canvas: HTMLCanvasElement = null;
	let renderer: THREE.WebGLRenderer = null;
	let camera: THREE.PerspectiveCamera = null;
	let scene: THREE.Scene = null;
	let visor: THREE.Mesh = null;
	let level: Level = null;

	let active: boolean = false;
	let deltaTime = 0;
	let lastTime = null;

	interface colorTheme {
		planeEven: number;
		planeOdd: number;
		slopeEven: number;
		slopeOdd: number;
	}
	const themes: colorTheme[] = [
		{ planeEven: 0x00c300, planeOdd: 0x007979, slopeEven: 0x808080, slopeOdd: 0x6c6c6c },
		{ planeEven: 0xc0c078, planeOdd: 0x780078, slopeEven: 0x5a9292, slopeOdd: 0x4c7b7b },
		{ planeEven: 0x6cafaf, planeOdd: 0x006b6b, slopeEven: 0xa57b7b, slopeOdd: 0x8f6b6b },
		{ planeEven: 0xb4b470, planeOdd: 0xa04300, slopeEven: 0x8c8c8c, slopeOdd: 0x767676 },
		{ planeEven: 0xbababa, planeOdd: 0x4444ba, slopeEven: 0x6caeae, slopeOdd: 0x5b9494 },
		{ planeEven: 0xc08f8f, planeOdd: 0xc00000, slopeEven: 0x99995e, slopeOdd: 0x838351 },
		{ planeEven: 0xc1c1c1, planeOdd: 0x780078, slopeEven: 0x955c95, slopeOdd: 0x825082 },
		{ planeEven: 0xc1c100, planeOdd: 0x4747c1, slopeEven: 0xad0000, slopeOdd: 0x920000 },
	];
	const customColors: Record<string, number> = {};
	let themeIdx: number = null;

	const disposables: (THREE.WebGLRenderTarget | THREE.BufferGeometry | THREE.Material)[] = [];

	const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
	const sunLight = new THREE.PointLight(0xffffff, 0.3);

	const allObjects: GameObject[] = [];

	$: setupScene(levelId, { dim, smooths, despikes, showGrid, showSurfaces, showAxis });

	onMount(async () => {
		canvas = document.querySelector('#mainViewCanvas');
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		renderer.setSize(window.innerWidth, (window.innerWidth * 9) / 16);
		setupScene(levelId, { dim, smooths, despikes, showGrid, showSurfaces, showAxis });
		requestAnimationFrame(render);
	});

	window.onresize = () => {
		viewWidth = window.innerWidth;
		viewHeight = (window.innerWidth * 9) / 16;
		renderer.setSize(viewWidth, viewHeight);
	};

	function render(time) {
		if (!scene) {
			requestAnimationFrame(render);
			return;
		}
		// compute time since last frame, so that user actions are proportional
		if (lastTime && Math.floor(lastTime / 200) !== Math.floor(time / 200)) {
			deltaTime = time - lastTime;
		}
		lastTime = time;

		// give all objects a chance to act
		const toRemove: number[] = [];
		allObjects.forEach((o, i) => {
			o.play(time);
			if (o.toRemove) {
				toRemove.push(i);
				scene.remove(o.object3D);
			}
		});
		toRemove.reverse().forEach(i => allObjects.splice(i, 1));

		const increment = keyPressed['Shift'] ? moveSpeed * 2 : moveSpeed;
		const directionSin = Math.sin(direction) * deltaTime * increment;
		const directionCos = Math.cos(direction) * deltaTime * increment;

		if (active) {
			// forward
			if (keyPressed['w']) {
				posX += directionCos;
				posY += directionSin;
			}
			// backward
			if (keyPressed['s']) {
				posX -= directionCos;
				posY -= directionSin;
			}
			// strafe left
			if (keyPressed['a']) {
				posX -= directionSin;
				posY += directionCos;
			}
			// strafe right
			if (keyPressed['d']) {
				posX += directionSin;
				posY -= directionCos;
			}
			// up
			if (keyPressed['q']) {
				posZ += deltaTime * moveSpeed;
			}
			// down
			if (keyPressed['e']) {
				posZ -= deltaTime * moveSpeed;
			}
			// [: FOV-
			if (keyPressed['[']) {
				cameraFov -= 1;
				camera.fov = cameraFov;
				camera.updateProjectionMatrix();
			}
			// ]: FOV+
			if (keyPressed[']']) {
				cameraFov += 1;
				camera.fov = cameraFov;
				camera.updateProjectionMatrix();
			}

			// cap horizontal coordinates inside the landscape
			posX = Math.max(0, Math.min(dim - 1.01, posX));
			posY = Math.max(0, Math.min(dim - 1.01, posY));

			// compute Z, wighted mean of the height of the 4 corners of the current square
			const x = Math.floor(posX);
			const dx = posX - x;
			const y = Math.floor(posY);
			const dy = posY - y;
			const zs = [map[y * dim + x], map[y * dim + x + 1], map[(y + 1) * dim + x + 1], map[(y + 1) * dim + x]];
			posZ =
				0.875 + zs[0] * (1 - dx) * (1 - dy) + zs[1] * dx * (1 - dy) + zs[2] * dx * dy + zs[3] * (1 - dx) * dy;

			const dirX = Math.cos(direction) * Math.cos(vertical);
			const dirY = Math.sin(direction) * Math.cos(vertical);
			const dirZ = Math.sin(vertical);

			visor.position.set(posX + dirX * 0.1, posY + dirY * 0.1, posZ + dirZ * 0.1);
			camera.position.set(posX, posY, posZ);
			camera.lookAt(visor.position);
		} else {
			// slowly rotate around the center of the map
			posX = dim / 2 + dim * 0.8 * Math.cos(time / 6000);
			posY = dim / 2 + dim * 0.8 * Math.sin(time / 6000);
			posZ = 15;

			camera.position.set(posX, posY, posZ);
			camera.lookAt(dim / 2, dim / 2, 0);
		}
		sunLight.position.set(
			dim / 2 + 20 * Math.cos(Math.PI / 3 + time / 6000),
			dim / 2 + 20 * Math.sin(Math.PI / 3 + time / 6000),
			30
		);

		renderer.render(scene, camera);

		requestAnimationFrame(render);
	}

	function dispose() {
		// TODO: actually mark objects for disposal
		disposables.forEach(item => item.dispose());
		disposables.splice(0);
	}

	function setupScene(
		levelId: number,
		options: {
			dim: number;
			smooths: number;
			despikes: number;
			showGrid: boolean;
			showSurfaces: boolean;
			showAxis: boolean;
		}
	) {
		if (!canvas || levelId === null) return;
		dispose();

		camera = new THREE.PerspectiveCamera(cameraFov, canvas.clientWidth / canvas.clientHeight, near, far);
		camera.up.set(0, 0, 1);

		level = generateLevel(levelId, options);
		map = level.map;
		console.log('codes:', level.codes);

		scene = new THREE.Scene();

		scene.add(ambientLight);

		sunLight.add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12)));
		scene.add(sunLight);

		// visor
		visor = new THREE.Mesh(new THREE.SphereGeometry(0.0005, 8, 8));
		visor.userData = { type: 'visor' };
		scene.add(visor);

		if (showAxis) {
			const axesHelper = new THREE.AxesHelper(10);
			scene.add(axesHelper);
		}

		themeIdx = level.nbSentries - 1;

		customColors.color1 = themes[themeIdx].slopeEven;
		customColors.color2 = themes[themeIdx].planeEven;

		const geometryPlane = new THREE.PlaneGeometry(1, 1);

		const materialLine = new THREE.LineBasicMaterial({ color: 0xffffff });
		const materialFlat = [
			new THREE.MeshPhongMaterial({ color: themes[themeIdx].planeEven, flatShading: true, specular: 0xa0a0a0 }),
			new THREE.MeshPhongMaterial({ color: themes[themeIdx].planeOdd, flatShading: true, specular: 0x404040 }),
		];
		const materialSlope = [
			new THREE.MeshPhongMaterial({
				color: themes[themeIdx].slopeEven,
				flatShading: true,
				specular: 0x404040,
				side: THREE.DoubleSide,
			}),
			new THREE.MeshPhongMaterial({
				color: themes[themeIdx].slopeOdd,
				flatShading: true,
				specular: 0x404040,
				side: THREE.DoubleSide,
			}),
		];

		// grid
		if (showGrid) {
			for (let x = 0; x < dim - 1; x++) {
				for (let y = 0; y < dim; y++) {
					const geometry = new THREE.BufferGeometry().setFromPoints([
						new THREE.Vector3(x, y, map[y * dim + x]),
						new THREE.Vector3(x + 1, y, map[y * dim + x + 1]),
					]);
					const line = new THREE.Line(geometry, materialLine);
					scene.add(line);
					disposables.push(geometry);
				}
			}
			for (let y = 0; y < dim - 1; y++) {
				for (let x = 0; x < dim; x++) {
					const geometry = new THREE.BufferGeometry().setFromPoints([
						new THREE.Vector3(x, y, map[y * dim + x]),
						new THREE.Vector3(x, y + 1, map[(y + 1) * dim + x]),
					]);
					const line = new THREE.Line(geometry, materialLine);
					scene.add(line);
					disposables.push(geometry);
				}
			}
		}

		// surfaces
		if (showSurfaces) {
			for (let y = 0; y < dim - 1; y++) {
				for (let x = 0; x < dim - 1; x++) {
					const vs = [
						// fl, fr, br, bl (anti-clockwise, starting lower left)
						{ x: x, y: y, z: map[y * dim + x], i: 0 },
						{ x: x + 1, y: y, z: map[y * dim + x + 1], i: 1 },
						{ x: x + 1, y: y + 1, z: map[(y + 1) * dim + x + 1], i: 2 },
						{ x: x, y: y + 1, z: map[(y + 1) * dim + x], i: 3 },
					];
					if (vs[0].z === vs[1].z && vs[0].z === vs[2].z && vs[0].z === vs[3].z) {
						// flat plane
						const plane = new THREE.Mesh(geometryPlane, materialFlat[(y + x) % 2]);
						plane.position.set(x + 0.5, y + 0.5, vs[0].z);
						plane.userData = { type: 'plane', x, y };
						scene.add(plane);
					} else {
						// general case: find lone highest or lowest
						const vss = vs.slice().sort((v1, v2) => v1.z - v2.z);
						const lone = vss[0].z === vss[1].z ? vss[3].i : vss[0].i;
						// rotate the set of vertexes to have the lone as v0, opposite as v2
						vs.push(...vs.splice(0, lone));

						const v0 = new THREE.Vector3(vs[0].x, vs[0].y, vs[0].z);
						const v1 = new THREE.Vector3(vs[1].x, vs[1].y, vs[1].z);
						const v2 = new THREE.Vector3(vs[2].x, vs[2].y, vs[2].z);
						const v3 = new THREE.Vector3(vs[3].x, vs[3].y, vs[3].z);

						// draw two triangles on both sides of v0-v2
						const material = materialSlope[(y + x) % 2];

						const geometry1 = new THREE.BufferGeometry().setFromPoints([v0, v1, v2]);
						const tri1 = new THREE.Mesh(geometry1, material);
						tri1.userData = { type: 'slope', x, y };
						scene.add(tri1);

						const geometry2 = new THREE.BufferGeometry().setFromPoints([v0, v2, v3]);
						const tri2 = new THREE.Mesh(geometry2, material);
						scene.add(tri2);
						tri2.userData = { type: 'slope', x, y };
						disposables.push(geometry1, geometry2);
					}
				}
			}
		}
		// objects
		allObjects.splice(0);
		for (const object of level.objects) {
			const models = {
				[GameObjType.SENTINEL]: Sentinel,
				[GameObjType.SENTRY]: Sentry,
				[GameObjType.MEANIE]: Meanie,
				[GameObjType.PEDESTAL]: Pedestal,
				[GameObjType.TREE]: Tree,
				[GameObjType.SYNTHOID]: Synthoid,
				[GameObjType.BOULDER]: Boulder,
			};
			addObject(models[object.type], 0, object.x, object.z, object.rot, object.step, object.timer);
		}
	}

	function handleMouseMove(e: MouseEvent) {
		if (active) {
			direction = (direction - e.movementX / 100) % (2 * Math.PI);
			vertical = Math.min(
				Math.max((vertical - e.movementY / 100) % (2 * Math.PI), -Math.PI / 2 + 0.1),
				Math.PI / 2 - 0.1
			);
		}
	}

	const keyPressed = {};
	function handleKeydown(e: KeyboardEvent) {
		keyPressed[e.key] = 1;
		if (e.key === 'r') {
			active = false;
			document.exitPointerLock();
		}
	}

	function handleKeyup(e: KeyboardEvent) {
		delete keyPressed[e.key];
	}

	function handleFocus() {
		// capture mouse
		active = true;
		canvas.requestPointerLock();

		posX = dim / 2; // start.posX;
		posY = dim / 2; // start.posY;
		posZ = 10;
		direction = 0;
		vertical = 0;
	}

	function addObject(
		cls: new (...args: any[]) => GameObject,
		time: number,
		x: number,
		y: number,
		rot: number,
		step: number = null,
		timer: number = null
	) {
		console.log(`add object ${cls.name} at ${x}/${y}`);

		// check if allowed, and compute height
		let z = map[y * dim + x];
		const objects = allObjects.filter(o => o.x === x && o.y === y);
		if (objects.length > 0) {
			if (objects.length === 1 && objects[0] instanceof Pedestal) {
				console.log('\tok (on empty pedestal');
				z += 1;
			} else if (objects[0] instanceof Boulder && objects[objects.length - 1] instanceof Boulder) {
				console.log(`\tok (on ${objects.length} boulders`);
				z += objects.length / 2;
			} else {
				console.log('\trefused:', objects);
				return false;
			}
		} else {
			console.log('\tok (empty cell)');
		}
		const gameObject = new cls(time, x, y, z, rot, step, timer, customColors);
		allObjects.push(gameObject);
		scene.add(gameObject.object3D);
	}

	function removeObject(x: number, y: number): boolean {
		console.log(`remove object at ${x}/${y}`);
		// collect all objects on this position
		const objects = allObjects.filter(o => o.x === x && o.y === y && !o.absorbedTime);

		// nothing there. TODO: Play error sound ?
		if (objects.length === 0) return false;

		const topObject = objects[objects.length - 1];
		console.log(`top object is: ${topObject.constructor.name}`);
		// if pedestal, never allowed (we can only have pedestal here if nothing is on it)
		if (topObject instanceof Pedestal) {
			console.log("\trefused: can't remove pedestal");
			return false;
		}
		// allowed if item is on boulder or if base cell is visible (height + 1 if sentinel)
		if (
			(objects.length > 1 && objects[0] instanceof Boulder) ||
			(objects.length > 1 && objects[0] instanceof Pedestal && isCellVisible(x, y, 1)) ||
			(objects.length === 1 && isCellVisible(x, y))
		) {
			console.log('\tok');
			topObject.remove(lastTime);
		} else {
			console.log('\trefused');
		}
	}

	function isCellVisible(x: number, y: number, zOffset: number = 0): boolean {
		console.log(`isCellVisible for ${x}/${y}`);
		const raycaster = new THREE.Raycaster();
		const eyePosition = camera.position;
		const targetHeight = map[y * dim + x] + zOffset;

		// if eye is below target, it's a fast no
		if (eyePosition.z < targetHeight) {
			console.log(`too low: ${eyePosition.z} < ${targetHeight}`);
			return false;
		}

		// else check rays toward each corner. True is at least one has no obstacle before
		let visible = false;
		for (const v of [
			[x, y],
			[x + 1, y],
			[x, y + 1],
			[x + 1, y + 1],
		]) {
			console.log(`testing ray to ${v[0]}/${v[1]}`);
			const target = new THREE.Vector3(v[0], v[1], targetHeight);
			const path = target.clone().sub(eyePosition);
			const distance = path.length();
			const direction = path.setLength(1);
			raycaster.set(eyePosition, direction);
			const intersects = raycaster.intersectObjects(scene.children);
			console.log('meets: ', intersects);
			for (let i = 0; i < intersects.length && !visible; i++) {
				const int = intersects[i];
				let object = int.object;
				while (object.parent !== scene) object = object.parent;
				// ignore the visor that might get in the way
				if (object.userData.type === 'visor') continue;
				// also ignore objects on the same cell
				if (object.userData.x === x && object.userData.y === y) continue;
				// stop if we find something before the target
				if (int.distance < distance) {
					const data = int.object.userData;
					console.log(`\tray to ${v[0]}/${v[1]} met object ${data.type} ${data.x}/${data.y}`);
					break;
				}
				// check if we reached the target
				if (int.distance >= distance) {
					console.log(`\tray to ${v[0]}/${v[1]} met target !`);
					visible = true;
				}
			}
			if (visible) break;
		}
		console.log(`verdict: ${visible}`);
		return visible;
	}

	function handleClick(event: MouseEvent) {
		if (!active) return;

		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
		const intersects = raycaster.intersectObjects(scene.children);

		for (let i = 0; i < intersects.length; i++) {
			// ignore the visor
			if (intersects[i].object.userData?.type === 'visor') continue;

			let object = intersects[i].object;
			while (object.parent !== scene) {
				object = object.parent;
			}
			if (!object.userData) return;
			console.log(object.userData);

			if (event.button === 0) {
				if (!['plane', 'slope'].includes(object.userData.type))
					removeObject(object.userData.x, object.userData.y);
			} else if (event.button === 1) {
				if (object.userData.type !== 'slope') {
					const cls = event.shiftKey ? Meanie : event.ctrlKey ? Sentinel : Synthoid;
					const rot = rng256(); // TODO: synthoid should face us
					addObject(cls, lastTime, object.userData.x, object.userData.y, rot);
				}
			} else if (event.button === 2) {
				if (object.userData.type !== 'slope') {
					const cls = event.shiftKey ? Tree : event.ctrlKey ? Sentry : Boulder;
					const rot = rng256();
					addObject(cls, lastTime, object.userData.x, object.userData.y, rot);
				}
			}
			break;
		}
	}
</script>

<main>
	{#if showPosition}
		<div>
			Position: x=<input type="number" bind:value={posX} />, y=<input type="number" bind:value={posY} />, z=<input
				type="number"
				bind:value={posZ}
			/>
		</div>
		<div>
			view direction horizontal={Math.floor((direction * 180) / Math.PI)}°, vertical={Math.floor(
				(vertical * 180) / Math.PI
			)}°
		</div>
	{/if}
	<div>
		<label>Settings: <input type="checkbox" bind:checked={showSettings} /></label>
	</div>

	<canvas
		id="mainViewCanvas"
		on:mousemove|preventDefault={handleMouseMove}
		on:click={handleClick}
		on:keydown|preventDefault={handleKeydown}
		on:keyup|preventDefault={handleKeyup}
		on:focus={handleFocus}
		tabindex="0"
	/>

	{#if showSettings}
		<div id="settings">
			{Math.round(1000 / deltaTime)} FPS / FOV:{cameraFov}<br />
			<label>Grid: <input type="checkbox" bind:checked={showGrid} /></label>
			<label>Surfaces: <input type="checkbox" bind:checked={showSurfaces} /></label>
			<label>Axis: <input type="checkbox" bind:checked={showAxis} /></label><br />
			<label>Size: <input type="range" bind:value={dim} min="5" max="64" /> {dim}</label><br />
			<label>Smooths: <input type="range" bind:value={smooths} min="0" max="5" /> {smooths}</label><br />
			<label>Despikes: <input type="range" bind:value={despikes} min="0" max="5" /> {despikes}</label><br />
		</div>
	{/if}
</main>

<style>
	#mainViewCanvas {
		image-rendering: pixelated;
	}
	#settings {
		padding: 8px;
	}
</style>
