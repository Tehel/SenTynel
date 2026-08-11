/*
 Route planner across the 10000 landscapes.

 Reads utils/all.csv (regenerate it with `node utils/all-levels.js > utils/all.csv`)
 and writes three routes from landscape 0 to landscape 9999:

   path-shortest.csv         fewest landscapes played, no difficulty constraint
   path-easiest.csv          fewest landscapes played among routes that never
                             exceed SECONDARY_CAP secondary sentries
   path-fewest-sentries.csv  fewest secondary sentries encountered in total,
                             also capped, at the cost of a longer route
   path-no-tower.csv         every landscape has heightGap 0, so the Sentinel is
                             always reachable from a single boulder — no leapfrog
                             tower anywhere. Costs exactly one extra hop over the
                             unconstrained optimum. Landscape 9999 is the sole
                             exception and cannot be avoided: it has heightGap 1
                             and is the destination, so the run's final landscape
                             needs a 3-boulder tower whatever route you take.

 The graph: completing landscape i advances by however much energy is left, so the
 edges out of i are i+1 .. i+maxJump(i) (a shorter hop is always available — just
 leave energy on the table). maxJump comes straight from all-levels.js and is an
 upper bound: it assumes every tree, sentry and the Sentinel can be absorbed, and
 that the second-highest flat tile is both reachable and has line of sight to the
 Sentinel. Landscape 9999 is the destination, never a waypoint, so its own
 difficulty is exempt from the cap.

 Usage: node utils/paths.js
*/

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = 9999;

// Highest difficulty any waypoint is allowed to have, as secondary sentries
// (i.e. excluding the Sentinel). 4 is infeasible: 9131 is the furthest <= 4
// landscape reachable, everything from 9132 to 9173 has 5 or more, and 9131 only
// affords a 28-landscape jump against the 43 needed to clear that stretch. 5 is
// the lowest cap that gets to 9999.
const SECONDARY_CAP = 5;

// nbSentries in all.csv counts the Sentinel, the difficulty measure doesn't.
const rows = readFileSync(join(HERE, 'all.csv'), 'utf8')
	.trim()
	.split('\n')
	.slice(1)
	.map(line => {
		const [levelId, nbSentries, nbTrees, totalEnergy, heightGap, maxJump, codeST] = line.split(',');
		return {
			id: +levelId,
			sentries: +nbSentries - 1,
			trees: +nbTrees,
			energy: +totalEnergy,
			gap: +heightGap,
			jump: +maxJump,
			code: codeST,
		};
	});

// ---------------------------------------------------------------------------
// Fewest landscapes played among the waypoints `usable` accepts.
//
// Breadth-first, but the reachable set from any landscape is a contiguous
// interval, so once a landscape has been considered it never needs revisiting:
// `furthest` walks forward monotonically and every landscape is settled exactly
// once, in increasing hop count. Rejected landscapes are skipped for good.
//
// Landscape 0 (where every run starts) and 9999 (the destination, and the only
// landscape you cannot route around) are always allowed regardless of `usable`.
// ---------------------------------------------------------------------------
function fewestHops(usable) {
	const allowed = r => r.id === 0 || r.id === TARGET || usable(r);
	const prev = new Int32Array(TARGET + 1).fill(-1);
	const dist = new Int32Array(TARGET + 1).fill(-1);
	dist[0] = 0;

	let frontier = [0];
	let furthest = 0;
	while (frontier.length > 0 && dist[TARGET] === -1) {
		const next = [];
		for (const i of frontier) {
			const reach = Math.min(i + rows[i].jump, TARGET);
			for (let j = Math.max(furthest + 1, i + 1); j <= reach; j++) {
				if (!allowed(rows[j])) continue;
				dist[j] = dist[i] + 1;
				prev[j] = i;
				next.push(j);
			}
			furthest = Math.max(furthest, reach);
		}
		frontier = next;
	}
	return dist[TARGET] === -1 ? null : walkBack(prev);
}

// ---------------------------------------------------------------------------
// Fewest secondary sentries met along the way, capped the same as above.
//
// Every edge goes forward, so a single ascending sweep relaxes the whole graph —
// no priority queue needed. Cost is charged on arrival; ties break towards the
// shorter route.
// ---------------------------------------------------------------------------
function fewestSentries(cap) {
	const INFINITE = Number.MAX_SAFE_INTEGER;
	const cost = new Array(TARGET + 1).fill(INFINITE);
	const hops = new Int32Array(TARGET + 1);
	const prev = new Int32Array(TARGET + 1).fill(-1);
	cost[0] = 0;

	for (let i = 0; i < TARGET; i++) {
		if (cost[i] === INFINITE) continue;
		const reach = Math.min(i + rows[i].jump, TARGET);
		for (let j = i + 1; j <= reach; j++) {
			if (j !== TARGET && rows[j].sentries > cap) continue;
			const c = cost[i] + rows[j].sentries;
			const h = hops[i] + 1;
			if (c < cost[j] || (c === cost[j] && h < hops[j])) {
				cost[j] = c;
				hops[j] = h;
				prev[j] = i;
			}
		}
	}
	return cost[TARGET] === INFINITE ? null : walkBack(prev);
}

function walkBack(prev) {
	const path = [];
	for (let i = TARGET; i !== -1; i = prev[i]) path.push(i);
	return path.reverse();
}

// jumpToNext doubles as the energy to finish the landscape with — the jump *is*
// the leftover energy. The last row is the destination, so it has none.
function write(name, path) {
	const lines = ['step,levelId,codeST,secondarySentries,maxJump,jumpToNext'];
	path.forEach((id, step) => {
		const jump = step + 1 < path.length ? path[step + 1] - id : '';
		lines.push(`${step},${id},${rows[id].code},${rows[id].sentries},${rows[id].jump},${jump}`);
	});
	writeFileSync(join(HERE, name), lines.join('\n') + '\n');

	const played = path.slice(0, -1); // 9999 itself is arrived at, not played through
	const histogram = {};
	for (const id of played) histogram[rows[id].sentries] = (histogram[rows[id].sentries] ?? 0) + 1;
	const total = played.reduce((s, id) => s + rows[id].sentries, 0);
	const peak = Math.max(...played.map(id => rows[id].sentries));
	console.log(`${name}: ${path.length - 1} hops, ${total} secondary sentries total, ${peak} at worst`);
	console.log(`  landscapes by secondary sentry count: ${JSON.stringify(histogram)}`);
}

write('path-shortest.csv', fewestHops(() => true));
write('path-easiest.csv', fewestHops(r => r.sentries <= SECONDARY_CAP));
write('path-fewest-sentries.csv', fewestSentries(SECONDARY_CAP));
write('path-no-tower.csv', fewestHops(r => r.gap === 0));

// path-shortest.csv:        220 hops, 1252 secondary sentries total, 7 at worst
// path-easiest.csv:         251 hops, 1061 secondary sentries total, 5 at worst
// path-fewest-sentries.csv: 348 hops,  575 secondary sentries total, 5 at worst
// path-no-tower.csv:        221 hops, 1260 secondary sentries total, 7 at worst
//
// Combining both constraints (heightGap 0 and <= 5 secondary sentries) also works,
// at 254 hops — swap in `r => r.gap === 0 && r.sentries <= SECONDARY_CAP`.
