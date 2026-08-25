<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import MainMenu from './ui/MainMenu.svelte';
	import PauseOverlay from './ui/PauseOverlay.svelte';
	import WinScreen from './ui/WinScreen.svelte';
	import LoseScreen from './ui/LoseScreen.svelte';
	import HelpLine from './ui/HelpLine.svelte';
	import PortraitOverlay from './ui/PortraitOverlay.svelte';
	import ScanVignette from './ui/ScanVignette.svelte';
	import { load } from './settings.svelte';
	import {
		enterFullscreenLandscape, exitFullscreen, isTouchCapable, setWakeLockWanted,
	} from './engine/platform';
	import { beginTrack, extendTrack, isTap, type GestureTrack } from './engine/touchGestures';
	import {
		game, pauseGame, giveUp, returnToMenu, advanceDemo, exitDemo, failDemo, startDemo,
		resumeDemo,
	} from './game/state.svelte';
	import { loadStats } from './game/stats.svelte';
	import { demoProgress, loadDemoProgress } from './game/demo.svelte';
	import { DEMO_LOSS_HOLD_MS, DEMO_WIN_HOLD_MS } from './game/timing';

	load();
	loadStats();
	loadDemoProgress();

	/*
	 Touch devices open straight into attract mode.

	 The menu is an arrow-key tree and the game is a mouse-look game; until PLAN-MOBILE.md's Phase M4
	 gives touch its own controls, a phone that lands on MENU is a phone looking at a list it cannot
	 move through. The demo needs neither — it drives itself — so it is the one thing a touch device
	 can actually be shown today, and showing it beats showing an inert menu.

	 Run at App init rather than from an effect: game.phase is read by MainView's own effects on the
	 first flush, so deciding who is driving before any of them mount avoids a frame of MENU and the
	 scene rebuild that leaving it would cost. isTouchCapable() is the same coarse heuristic Start
	 uses for fullscreen (engine/platform.ts) — a touch-screen laptop gets attract mode too, and
	 exits it with any key, which is precisely the thing it has and a phone does not.
	*/
	if (isTouchCapable()) startDemo();

	// TRANSFER's return to PLAYING is driven by the camera's transfer glide finishing
	// (engine/loop.ts calls completeTransfer() once CameraController.updateTransfer signals
	// completion), the same pattern as BIRDSEYE's completeBirdsEyeExit(). WON/LOST are
	// keypress-only — WinScreen/LoseScreen call completeWon()/completeLost() directly.

	/*
	 Demo supervisor: the half of attract mode that no player is present for.

	 A demo win or loss holds its end screen for a beat — long enough to read, which is the whole
	 point of showing it to a passer-by — and then moves on by itself. This is the WON/LOST timer
	 PLAN.md records as deliberately removed, back for demo mode only: it was wrong for a player,
	 who wants to leave the screen at their own pace, and it is the only way an unattended run
	 continues.

	 A win goes to advanceDemo(), which moves the bot's own cursor and begins the next landscape
	 without touching the player's progress. A loss — including the watchdog's verdict on a
	 landscape going nowhere (engine/bot.ts) — goes to failDemo(), which retries the landscape and
	 blacklists it after three consecutive failures, rewinding to the win that paid for it. It never
	 steps over a landscape the bot couldn't win, so the cursor still can't advance unearned; what it
	 no longer does is stop and wait for a witness. failDemo() hands back to the menu itself when
	 there is nothing behind it to re-steer, which is the old behaviour on the demo's first
	 landscape — except on touch, where handing back is useless: that menu is an arrow-key tree a phone
	 cannot drive, so failDemo is asked to strand the demo in PAUSED instead, where its touch controls
	 already offer the two things the situation calls for (pick another landscape, or reset). Its escape
	 hatch either way is a reset — Delete on the menu's Demo line, or the pause overlay's own button.
	*/
	$effect(() => {
		if (!game.demo) return;
		if (game.phase !== 'WON' && game.phase !== 'LOST') return;
		const won = game.phase === 'WON';
		const timer = setTimeout(
			() => (won ? advanceDemo() : failDemo({ haltWhenStranded: isTouchCapable() })),
			won ? DEMO_WIN_HOLD_MS : DEMO_LOSS_HOLD_MS
		);
		return () => clearTimeout(timer);
	});

	/*
	 TOUCH CONTROL OF THE DEMO (PLAN-MOBILE.md).

	 The demo is all a touch device can be shown until Phase M4 (see the auto-start above), so it needs
	 the two controls a watcher actually wants — stop it to look at something, and pick what it plays —
	 without a keyboard and without the menu.

	 Only ONE of those is a screen gesture: a tap toggles the pause. Everything else is a control on the
	 pause overlay, which is where it belongs. Picking a landscape started out as a swipe here and was
	 wrong — a swipe steps by one, an unlocked list runs to hundreds, so choosing cost a gesture per
	 entry; it is now a draggable strip with momentum inside PauseOverlay. Reset was never a gesture: a
	 hidden, unconfirmed one is the wrong home for the action that wipes the bot's record, and on a
	 tablet lying flat a resting palm is a long press.

	 The tap listener is here rather than per-component because tap-to-pause has to work while PLAYING
	 and tap-to-resume while PAUSED — splitting that across MainView and PauseOverlay would mean two
	 handlers racing to interpret one touch. The overlay's own controls opt out via data-touch-control.
	*/
	let gesture: GestureTrack | null = null;
	/*
	 The landscape the pause overlay's picker is naming — PENDING, not applied. MainView's Effect 2 keys
	 the scene rebuild on currentLevelId(), so writing demoProgress.levelId as the strip moved would
	 demolish the paused run on the first drag, and with momentum it would rebuild the scene dozens of
	 times per flick. Holding it here means you can scrub the whole list, change your mind, and resume
	 exactly what you were watching. resumeDemo() decides which of those two happened.
	*/
	let demoPendingLevel = $state<number | null>(null);

	const touchDemoActive = () => game.demo && isTouchCapable();

	function onTouchStart(event: TouchEvent) {
		if (!touchDemoActive()) return;
		// A touch that lands on one of the overlay's own controls belongs to that control. Tracking
		// it here would read the same press as a screen tap and resume the demo out from under the
		// button — including the reset's Confirm, which would then act on a demo that had restarted.
		if ((event.target as Element | null)?.closest?.('[data-touch-control]')) {
			gesture = null;
			return;
		}
		if (event.touches.length > 1) {
			// Second finger down mid-gesture: mark the track spoiled rather than restarting it, so
			// lifting one finger can't turn the tail of a pinch into a swipe.
			if (gesture) gesture.multiTouch = true;
			return;
		}
		gesture = beginTrack(event.touches[0].clientX, event.touches[0].clientY);
	}

	function onTouchMove(event: TouchEvent) {
		if (!gesture) return;
		if (event.touches.length > 1) {
			gesture.multiTouch = true;
			return;
		}
		extendTrack(gesture, event.touches[0].clientX, event.touches[0].clientY);
	}

	function onTouchEnd() {
		const track = gesture;
		gesture = null;
		if (!track || !touchDemoActive()) return;
		// A drag is not an instruction: only a touch that stayed put counts, so a stray swipe across
		// the canvas costs nothing.
		if (!isTap(track)) return;

		if (game.phase === 'PLAYING' || game.phase === 'TRANSFER') {
			// Seed the picker from the landscape actually running, so an untouched pause resumes
			// rather than restarting — and so a reset from a previous pause leaves nothing stale.
			demoPendingLevel = demoProgress.levelId;
			pauseGame();
		} else if (game.phase === 'PAUSED') {
			/*
			 Called BEFORE resumeDemo, and this is the one ordering that matters here: requestFullscreen
			 only works inside a user gesture, and this handler is one. Anything asynchronous in front
			 of it — or moving it into an effect that reacts to the phase — spends the gesture and the
			 request is refused. See engine/platform.ts.
			*/
			enterFullscreenLandscape();
			resumeDemo(demoPendingLevel);
			demoPendingLevel = null;
		}
		// WON/LOST are left alone: the demo supervisor above is already holding those for a beat
		// before moving on by itself, and there is nothing for a tap to usefully do to a result.
	}

	/*
	 A stranded demo (failDemo above) reaches PAUSED without any gesture, so seed the picker here too —
	 otherwise it would name whatever the last pause left behind, or nothing at all.
	*/
	$effect(() => {
		if (game.demoHalted) demoPendingLevel = demoProgress.levelId;
	});

	/*
	 KEEP THE SCREEN AWAKE while the game is on, and only then — see engine/platform.ts for why this
	 has to be a standing want rather than a one-off request.

	 The two halves of the rule differ because the two situations do. A DEMO is unattended by
	 definition: it plays for hours touching nothing, so every phase but PAUSED should hold the screen,
	 including the few seconds of a win or loss screen the supervisor is about to move on from —
	 dropping the lock for four seconds every landscape would be pure churn.

	 A PERSON gets the lock only while actually playing. Their win and loss screens are dismissed by a
	 keypress that may never come, and someone who walks away from a win screen should be allowed to
	 have their phone go to sleep. PAUSED releases in both cases, which is the same call the fullscreen
	 effect below makes and for the same reason: paused means the device is theirs again. MENU too — a
	 menu is somewhere you are, or somewhere the app was left.
	*/
	$effect(() => {
		const playing =
			game.phase === 'PLAYING' ||
			game.phase === 'TRANSFER' ||
			game.phase === 'BIRDSEYE' ||
			game.phase === 'DEBUG';
		setWakeLockWanted(game.demo ? game.phase !== 'PAUSED' : playing);
	});

	/*
	 A paused demo hands the screen back: the system bars return, so an attract mode on somebody's
	 tablet always has a visible way out. Entering fullscreen is the tap handler's job (it needs the
	 gesture); LEAVING needs none, so it belongs here, where it catches every route into PAUSED —
	 the tap, the Android back gesture, and failDemo stranding the demo.

	 Touch-only, deliberately. On a desktop, fullscreen is something the player asked for from the
	 menu and pausing is not a request to undo it.
	*/
	$effect(() => {
		if (game.demo && game.phase === 'PAUSED' && isTouchCapable()) exitFullscreen();
	});

	// Android back-gesture / browser back-button guard (PLAN-MOBILE.md Phase M0): Phase 4
	// deliberately has no mid-level save, so an unguarded back swipe would silently discard a
	// whole landscape's progress. A history entry is pushed for the duration of a game session
	// (anything past MENU); popstate while it's in place is routed into the same pause flow ESC
	// already uses, then immediately re-pushed so the gesture doesn't actually navigate away.
	// Once back at MENU the guard drops, so the *next* back press behaves normally (harmless on
	// a single-page app — at worst it exits, matching Android's own "back from the main screen"
	// convention).
	let historyGuarded = false;
	$effect(() => {
		if (game.phase === 'MENU') {
			historyGuarded = false;
		} else if (!historyGuarded) {
			history.pushState({ sentynel: true }, '');
			historyGuarded = true;
		}
	});

	function handlePopState() {
		if (!historyGuarded) return;
		// A demo has no progress worth guarding and nobody watching for the resume key, so a back
		// gesture is treated the way any other deliberate input is: it ends the demo. Pausing it
		// would leave the overlay up with no way out but another gesture.
		//
		// Except on touch, where the menu it would drop into cannot be operated (see the auto-start
		// above). There the gesture pauses the demo instead — "step out of what I am looking at" is
		// what back means on Android, and the pause overlay is now somewhere to step out TO. A second
		// back press deliberately does nothing rather than resuming: back is not a toggle, and tap
		// already is one. The keyboard exit in MainView still works on devices that have a keyboard.
		if (game.demo) {
			if (!isTouchCapable()) exitDemo();
			else if (game.phase === 'PLAYING' || game.phase === 'TRANSFER') {
				demoPendingLevel = demoProgress.levelId;
				pauseGame();
			}
		} else if (game.phase === 'PAUSED') giveUp();
		else if (game.phase === 'PLAYING' || game.phase === 'TRANSFER' || game.phase === 'BIRDSEYE') pauseGame();
		else if (game.phase === 'DEBUG') returnToMenu();
		history.pushState({ sentynel: true }, '');
	}
</script>

<svelte:head><title>The SenTynel</title></svelte:head>

<svelte:window
	onpopstate={handlePopState}
	ontouchstart={onTouchStart}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
	ontouchcancel={() => (gesture = null)}
/>

<main>
	<MainView />
	<Hud />
	{#if game.phase === 'PLAYING' || game.phase === 'BIRDSEYE'}
		<HelpLine />
	{:else if game.phase === 'MENU'}
		<MainMenu />
	{:else if game.phase === 'PAUSED'}
		<PauseOverlay pendingLevelId={demoPendingLevel} onPick={id => (demoPendingLevel = id)} />
	{:else if game.phase === 'WON'}
		<WinScreen />
	{:else if game.phase === 'LOST'}
		<LoseScreen />
	{/if}
	<!-- Self-gating on phase and scan state, like Hud — always mounted so it can appear the instant
	     a watcher's attention lands on the player, without waiting on a phase-keyed remount. -->
	<ScanVignette />
	<PortraitOverlay />
</main>

<style>
</style>
