/*
 Re-aggregate a chunked bot sweep into one summary.

 The trap this exists to avoid: every chunk prints its own `sweep summary`, each a mean over its own
 slice. Averaging averages is wrong when the slices differ in size, and summing "mean jump" lines is
 meaningless — so this parses ONLY the per-landscape lines and recomputes everything from them. The
 chunk summaries are deliberately ignored.

 Output is byte-compatible with the harness's own afterAll summary, so a chunked run can be diffed
 against a single-process run of the same block.

   node utils/sweep-aggregate.js out/b4-pre/chunk-*.log
   node utils/sweep-aggregate.js --expect 1000 --snapshot out/b4-pre.txt out/b4-pre/chunk-*.log

 --snapshot writes a `levelId result transfers` table in the same three-column shape as
 utils/bot-v2-3000-3999.txt, so a measured block becomes a committed artifact to pick landscapes from.
*/
import { readFileSync, writeFileSync } from 'node:fs';

// `sweep 3000 [v2]: WON +33 | transfers 6 | failures 6 | retries 0 | bucket won | max 40`
// The planner tag is absent when only one planner ran, and bucket/max are absent in logs written
// before those fields existed — both optional so old logs still aggregate.
const LINE =
	/^\s*sweep (\d+)(?: \[(\w+)\])?:\s+(WON \+(\d+)|LOST|PLAYING|TRANSFER|\w+)\s+\| transfers (\d+) \| failures (\d+) \| retries (\d+)(?: \| bucket (\S+))?(?: \| max (\d+|\?))?/;

const BUCKETS = [
	'won',
	'died-in-opening',
	'bled-out',
	'never-reached-assault-position',
	'burned-purse',
	'died-after-the-Sentinel',
	'watchdog-stalled',
	'out-of-clock',
];

const args = process.argv.slice(2);
let expect = null;
let snapshot = null;
// The harness omits the `[v2]` tag when only one planner ran, so a single-planner log cannot say which
// one it was. The caller knows, and a committed artifact that does not name its planner is useless.
let label = null;
const files = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--expect') expect = Number(args[++i]);
	else if (args[i] === '--snapshot') snapshot = args[++i];
	else if (args[i] === '--label') label = args[++i];
	else files.push(args[i]);
}
if (files.length === 0) {
	console.error('usage: node utils/sweep-aggregate.js [--expect N] [--snapshot file] <chunk logs...>');
	process.exit(1);
}

// Keyed by planner then landscape, so a landscape appearing in two logs (a re-run of one chunk) is
// counted once rather than twice.
const rows = new Map();
let parsed = 0;
for (const file of files) {
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch (e) {
		console.error(`  ! cannot read ${file}: ${e.message}`);
		continue;
	}
	for (const line of text.split('\n')) {
		const m = LINE.exec(line);
		if (!m) continue;
		const planner = m[2] ?? label ?? 'default';
		if (!rows.has(planner)) rows.set(planner, new Map());
		rows.get(planner).set(Number(m[1]), {
			id: Number(m[1]),
			won: m[3].startsWith('WON'),
			jump: m[4] ? Number(m[4]) : 0,
			phase: m[3].startsWith('WON') ? 'WON' : m[3],
			transfers: Number(m[5]),
			failures: Number(m[6]),
			retries: Number(m[7]),
			bucket: m[8] ?? null,
			maxJump: m[9] && m[9] !== '?' ? Number(m[9]) : null,
		});
		parsed++;
	}
}
if (parsed === 0) {
	console.error('no per-landscape sweep lines found — was --reporter=verbose used, and BOT_SWEEP=1 set?');
	process.exit(1);
}

console.log('\nsweep summary');
const wonBy = new Map();
for (const [planner, byId] of rows) {
	const all = [...byId.values()].sort((a, b) => a.id - b.id);
	const wins = all.filter(r => r.won);
	wonBy.set(planner, new Set(wins.map(r => r.id)));
	const banked = wins.reduce((s, r) => s + r.jump, 0);
	// Against what those same landscapes could have funded, so the ratio is not skewed by which ones
	// happened to be won — the harness's own convention.
	const available = wins.reduce((s, r) => s + (r.maxJump ?? 0), 0);
	const ratio = available > 0 ? Math.round((100 * banked) / available) : 0;
	console.log(
		`  ${planner}: won ${wins.length}/${all.length}` +
			` | mean jump ${(banked / Math.max(1, wins.length)).toFixed(1)}` +
			` of maxJump ${(available / Math.max(1, wins.length)).toFixed(1)} (${ratio}%)` +
			` | reached maxJump ${wins.filter(r => r.maxJump !== null && r.jump >= r.maxJump).length}`
	);
	if (all.some(r => r.bucket)) {
		const histogram = BUCKETS.map(b => `${b} ${all.filter(r => r.bucket === b).length}`).filter(s => !s.endsWith(' 0'));
		console.log(`    buckets: ${histogram.join(' | ')}`);
	}
	if (expect !== null && all.length !== expect) {
		// A silent shortfall would read as a lower win rate, which is the one failure mode that could
		// send a whole measurement the wrong way.
		const seen = new Set(all.map(r => r.id));
		const ids = all.map(r => r.id);
		const missing = [];
		for (let id = Math.min(...ids); id <= Math.max(...ids) && missing.length < 40; id++) {
			if (!seen.has(id)) missing.push(id);
		}
		console.log(`    ! INCOMPLETE: ${all.length} of ${expect} landscapes — missing ${missing.join(' ')}${missing.length >= 40 ? ' …' : ''}`);
	}
}
for (const [planner, won] of wonBy) {
	const lost = [...rows.get(planner).values()].filter(r => !won.has(r.id)).map(r => r.id).sort((a, b) => a - b);
	if (lost.length > 0) console.log(`  ${planner} lost ${lost.length}: ${lost.join(' ')}`);
}
// The trade, which the totals hide: two configurations can score the same while winning different
// landscapes, and that wasted several tuning passes before it was printed.
const planners = [...wonBy.keys()];
for (let i = 1; i < planners.length; i++) {
	const base = wonBy.get(planners[0]);
	const other = wonBy.get(planners[i]);
	const gained = [...other].filter(id => !base.has(id)).sort((a, b) => a - b);
	const lost = [...base].filter(id => !other.has(id)).sort((a, b) => a - b);
	console.log(`  ${planners[i]} vs ${planners[0]}: +${gained.length} ${gained.join(' ')} | -${lost.length} ${lost.join(' ')}`);
}

if (snapshot) {
	const [planner, byId] = [...rows.entries()][0];
	const all = [...byId.values()].sort((a, b) => a.id - b.id);
	const wins = all.filter(r => r.won);
	const banked = wins.reduce((s, r) => s + r.jump, 0);
	const available = wins.reduce((s, r) => s + (r.maxJump ?? 0), 0);
	const lines = [
		`# ${planner} sweep of landscapes ${all[0].id}-${all[all.length - 1].id}. Columns: levelId result transfers`,
		`# ${wins.length}/${all.length} won, mean jump ${(banked / Math.max(1, wins.length)).toFixed(1)}` +
			` of maxJump ${(available / Math.max(1, wins.length)).toFixed(1)}` +
			` (${available > 0 ? Math.round((100 * banked) / available) : 0}%).`,
		'# Goes stale as the planner changes — a snapshot to pick landscapes from, not a fixture.',
		...all.map(r => `${r.id} ${r.phase} ${r.transfers}`),
	];
	writeFileSync(snapshot, lines.join('\n') + '\n');
	console.log(`\nsnapshot written to ${snapshot}`);
}
