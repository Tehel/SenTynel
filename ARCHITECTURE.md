# SenTynel — annotated source layout

The full, annotated file tree. `CLAUDE.md` carries a short index version of this
tree; this file is where the reasoning behind each module lives — including the
notes that only exist here, and the "we tried that, don't re-try it" warnings.

Companion documents hold the narrative accounts these annotations refer to:
`PLAN.md` (roadmap), `BOT.md` + `PLAN-BOT2.md` (the demo bot and its postscripts),
`PLAN-EXPOSURE.md` (the exposure map), `RULES-FIDELITY.md` + `PLAN-RULES.md`
(rules vs. the original game), `PLAN-MOBILE.md`, `PLAN-BOT3.md`, `STRATEGY-HUMAN.md`.

## Source layout (`src/`)

```
src/
  main.ts               Svelte entry — mount() App to document.body
  App.svelte            Top-level; composes MainView, Hud, a phase-keyed overlay
                        (HelpLine/MainMenu/PauseOverlay/WinScreen/LoseScreen), and the
                        always-mounted PortraitOverlay; calls load()/loadStats()/
                        loadDemoProgress(); owns the demo supervisor ($effect, demo-gated:
                        holds WON/LOST for DEMO_{WIN,LOSS}_HOLD_MS then advanceDemo() or
                        exitDemo() — see DEMO below; human WON/LOST stay keypress-only) and
                        the Android back-gesture/back-
                        button guard (PLAN-MOBILE.md Phase M0): pushes a history entry for
                        the duration of any phase past MENU, and a popstate handler routes
                        the gesture into the same pause flow ESC already uses
                        (pauseGame()/returnToMenu()/giveUp()) instead of letting the
                        browser navigate away and silently discard level progress. On touch it
                        also auto-starts the demo at init (the menu is a keyboard tree, so a
                        phone reaching MENU is looking at a list it cannot operate) and owns
                        that demo's gesture layer (PLAN-MOBILE.md Phase M0.5): ONE window
                        touch listener, because tap-to-pause has to work while PLAYING and
                        tap-to-resume while PAUSED — splitting the stream between MainView and
                        PauseOverlay would put two handlers in a race over a single touch.
                        Recognition is engine/touchGestures.ts; this file maps the one gesture
                        onto phases (a tap toggles the pause — picking a landscape is a control
                        on the overlay, not a gesture, since a swipe steps by one and the list
                        runs to hundreds) and holds demoPendingLevel: the landscape the pause
                        picker names, reported up through onPick and deliberately NOT written
                        through to demoProgress.levelId, since MainView's Effect 2 keys the
                        scene rebuild on currentLevelId() — a live cursor would demolish the
                        paused run, and under momentum would rebuild the scene dozens of times
                        per flick. resumeDemo() reads it back and decides resume-in-place vs.
                        begin-fresh.
                        The back gesture pauses a touch demo rather than being swallowed; a
                        second press does nothing, since back is not a toggle and tap is.
  settings.svelte.ts    Runes-based persistent settings (load/save to localStorage)

  ui/
    MainView.svelte     Canvas host; wires engine modules together. ~265 lines: Effect 1
                        (engine lifecycle), Effect 2 (scene rebuild), Effects 3a–3d
                        (game-start/debug-entry camera snap, post-transfer choreography,
                        pointer-lock acquire/release, watcher-cone visibility toggle).
    Hud.svelte          Energy icons only. Self-gates visibility to PLAYING/TRANSFER/
                        PAUSED; rAF-driven sine pulse on the icons when energy <= 3.
                        Also owns the action-cooldown bar (PLAYING + TRANSFER — a
                        successful transfer starts the cooldown and must keep showing
                        it through the ~1s camera move, unlike PAUSED which excludes
                        it): an 80px borderless white bar at ~2/3 screen width, that
                        reads lastActionAt/ACTION_COOLDOWN_MS via its own rAF loop and
                        shrinks right-to-left (anchored by `left`, not `right`, so the
                        shrinking width recedes toward the fixed left edge) to nothing
                        over the 1s cooldown.
    MainMenu.svelte      Arrow-key-driven menu tree (was Menu.svelte). Only mounted
                        during MENU: Start / Level: N, code: XXXXXXXX / Input level
                        code / Settings (Settings nested in the same tree). condition()
                        filters both rendering AND keyboard nav/dispatch via
                        visibleMenu/focusedName/currentEntry. "Input level code" swaps
                        the tree view for a hex input backed by game/levelCodes.ts.
                        Two mirrored top-level entries, Play and Demo, each carrying its own
                        cursor: Enter starts, Left/Right steps that cursor's own unlocked list
                        (settings.levelIds / demoProgress.levelIds, via the shared stepLevel
                        helper), Delete resets that record. Demo is labelled with the BOT's
                        landscape (game/demo.svelte.ts), which is the one it resumes — the two
                        lists are separate by design and neither line can move the other's; its
                        blacklist count is appended only under debug().
                        MenuEntry.del carries the reset (formerly Settings' last two entries)
                        and MenuEntry.hint the dim line under the menu that advertises it —
                        both use the same local-mode pattern (`confirming`, a
                        'player' | 'demo' | null) to show a confirm/cancel line before
                        calling game/state.svelte.ts's resetProgress()/resetDemoRun().
    PauseOverlay.svelte  Shown during PAUSED. Dims the canvas, "Paused" caption — or "Nowhere
                        Left To Go" for a stranded demo, which is not a pause anybody asked for.
                        On a touch demo it renders its own variant instead of the keyboard hint:
                        the landscape PICKER — a strip you press and drag, with momentum — and a
                        "Reset demo progress" button with the same confirm step the menu's
                        Delete uses, calling resetDemoAndRestart(). The picker owns the pointer
                        plumbing and the rAF loop; the physics is touchGestures.ts's Scrubber.
                        Three things there are easy to get wrong: the unlocked list is read ONCE
                        on mount (nothing can change it while the overlay is up — every path
                        that touches it starts a landscape, which unmounts this — and pinning it
                        keeps an index from meaning a different entry between frames); the
                        scrubber lives in a PLAIN let with `offset` mirrored into $state once per
                        frame, since it is mutated 60 times a second and nothing renders from it
                        directly; and onPick fires only when the ROUNDED entry changes, because
                        a drag writes an offset every frame but a choice is not an animation.
                        Pointer Events with setPointerCapture, so the drag survives the finger
                        leaving a strip one line tall and a mouse can exercise it at all, plus
                        touch-action: none or the browser claims the horizontal drag as a scroll
                        and cancels the pointer mid-gesture. Interactive controls carry
                        data-touch-control, which is how App.svelte's gesture handler knows to
                        leave that touch alone — otherwise the touch that drags the strip is
                        also read as a screen tap and resumes the demo out from under it;
                        #caption is otherwise pointer-events: none so the canvas keeps receiving
                        everything. Its keydown deliberately ignores a demo — MainView's demo
                        keydown ends it instead, and both firing on one event only worked by
                        listener order.
                        Own keydown: Escape -> giveUp() (second Escape, see Game phases),
                        any other non-modifier key -> resumeGame(). Bare Alt/Control/
                        Shift/Meta/AltGraph/OS are ignored — they're the leading half
                        of an OS window-switch shortcut, not a deliberate resume.
    WinScreen.svelte     Shown during WON. Own keydown calls completeWon() directly — or,
                        in demo mode, exitDemo(): a demo win advances by itself after a beat
                        (App.svelte's supervisor), so a keypress there is someone asking the
                        demo to stop, not to bank the landscape into their own progress. The
                        guard is explicit rather than relying on MainView's window handler
                        winning the registration race. Reads currentLevelId() and
                        activeStats(), so a demo win reports the run being watched.
                        Three branches: normal ("Landscape Complete" + jump/next line),
                        capped (next would exceed 9999 — capped-at-9999 message plus an
                        encouraging line), final (landscape 9999 — "Game
                        Completed" title, a stats.svelte.ts-driven summary instead of a
                        next-landscape line: landscapes unlocked, per-type absorb counts,
                        transfers, hyperspace jumps, deaths, completion count).
    LoseScreen.svelte    Shown during LOST. Same pattern, calls completeLost() (or exitDemo()
                        in demo mode). Titles off game.lostReason: "Energy Depleted", or
                        "Nowhere To Go" when the demo watchdog wrote the landscape off, since
                        the bot usually still has energy in hand at that point.
    HelpLine.svelte      Two static lines of key/mouse bindings, mounted only during
                        PLAYING.
    ScanVignette.svelte  THE "YOU ARE SEEN" CUE (RULES-FIDELITY.md C6). Always mounted in
                        App.svelte, self-gating on phase and game.scanState. A screen-edge
                        vignette: steady dim amber while a watcher sees your body but not your
                        square (it can take nothing — a Meanie is coming), and amber ramping to
                        red as the lock-on stall runs down, reaching full saturation exactly as
                        the drain starts. THE RAMP IS THE COUNTDOWN, which is what turns "you
                        are seen" into "you have about this long". More watchers deepens the
                        colour rather than widening the frame, since drains cumulate.
                        Deliberately unlike MainView's #drainFlash (a hard 200 ms spike at an
                        80 px inset, sitting above this in z-order): different speed, spread
                        and intensity is what keeps "act now" and "you already paid" from
                        reading as one event. Own rAF, because the ramp has to be smooth
                        between the 1 Hz drain ticks that update the state behind it.
    PortraitOverlay.svelte  CSS-only "rotate your device" screen (PLAN-MOBILE.md Phase
                        M0). Always mounted in App.svelte; visibility is driven purely by
                        an `@media (orientation: portrait)` query, no JS/game-phase
                        involvement — covers the moment before Start's fullscreen/
                        orientation-lock engages and any browser where the lock silently
                        fails.
    icons.ts            Base64 PNGs for HUD energy icons.

  engine/                              # Three.js-backed render + game-loop layer
    renderer.ts         WebGLRenderer + rAF loop (RendererManager)
    scene.ts            buildScene + addObjectToScene/replaceObjectInScene/removeObjectFromScene/
                        finishUnsupportedCorpses/canPlaceAt/objectsAt/topObjectAt. Owns SceneData
                        (incl. coneAssets) and the boulder-rotation alternation rule.
                        Terrain is merged into 4 meshes (per material — planeEven/Odd,
                        slopeEven/Odd) via BufferGeometryUtils.mergeGeometries; debug grid
                        is one LineSegments. Picker/visibility derive (col, row) from the
                        world-space hit point for terrain hits (kind:'terrain' on userData).
                        canPlaceAt AND addObjectToScene both filter absorbedTime !== null (2026-08-25,
                        RULES-FIDELITY.md A5): an object mid-absorb is gone to objectsAt and therefore
                        to every other rule, and these two re-derive the stack themselves — so until
                        this they alone kept the square occupied for the 1-2 s the animation runs, with
                        the DURATION set by the cosmetic Animation setting. Same bug as the 2026-08-24
                        skipRaycast fix, one site further on.
                        BUT A SQUARE A WATCHER EMPTIED IS NOT FREE EITHER (A5a, same day): a drain used
                        to be a morph in two halves — the target went at once, its replacement landed
                        500 ms later via a deferredSpawns queue — so A5 left that window holding nothing
                        and a player could take the square the rules had already promised, making the
                        morph fail and the landscape lose that energy for good. Closed first with a
                        reservation (cellReserved), then properly:
                        A MORPH IS ONE ATOMIC REPLACEMENT (A5b, same day, from a report of "a tree
                        suspended mid-air"). replaceObjectInScene removes the target and places its
                        replacement ON THE TARGET'S OWN RUNG in the same frame (in the RULES; its
                        creationTime is half an interval ahead, so on screen the old object still
                        squashes away before the new one inflates) — the rung is PASSED, not
                        re-derived, since stackedHeightAt filters out the corpse and so cannot see it.
                        The window is gone rather than guarded, which is why cellReserved, DeferredSpawn
                        and the queue are all gone with it: the replacement standing in the cell IS the
                        reservation. It also retires morphPlacementFailed — a replacement standing where
                        its predecessor stood cannot be refused. The bug the gap caused was worse than
                        the build hole: for 500 ms the RUNG BELOW was top-of-stack, so both actors could
                        take one tower apart at two levels, the replacement re-derived its altitude from
                        the shrunken stack and dropped to the ground, and the corpse was left hanging.
                        finishUnsupportedCorpses is the other half — the frame the last mesh UNDER a
                        corpse leaves the scene, the corpse goes too (called from loop.ts on any frame
                        that spliced something). Needed because the two morphs that have no replacement
                        — a tree drained off a boulder, and any player absorb — can still empty a rung.
                        Its surface counts corpses (screenSurfaceAt walks allObjects, not objectsAt): the
                        question is about the PICTURE, and a boulder mid-fade is still visibly holding
                        things up. Deliberately NOT fixed: the promotion itself. A watcher may still take
                        the rung under something you are absorbing — gone is gone — because a shield
                        would have to last as long as the longest absorb animation, putting a cosmetic
                        setting back in charge of the rules. 926 -> 926 on the verdict block, no
                        floats in 1000 runs, and 20 landscapes changing outcome either way — read as
                        noise: splicing a corpse at a different moment reorders allObjects, and array
                        order is a tie-break in objectsAt, the drain candidate list and the closest-
                        tree search. A two-landscape delta on a change like this measures the coin,
                        not the planner.
    camera.ts           CameraController — free-flight (DEBUG), look-only (PLAYING),
                        transfer glide (TRANSFER), orbit (MENU/WON/LOST), and bird's-eye
                        (BIRDSEYE). EYE_HEIGHT = 0.875 above feet/terrain.
                        aimAnglesFor(col,row,y) aims at a cell CENTRE; aimAnglesForPoint takes
                        FRACTIONAL grid coordinates, which is what lets the demo bot name a point
                        on a tile rather than a tile (engine/bot.ts's aimCandidates) — a cell is a
                        square and the crosshair is one ray.
                        enterBirdsEye/exitBirdsEye/cancelBirdsEye/updateBirdsEye drive a
                        scripted 1s ease-in-out fly to/from a fixed absolute height
                        (BIRDSEYE_HEIGHT=20) and pitch (-60°) — yaw carries through
                        unmodified during the scripted move (only height/pitch/FOV
                        interpolate; see lerpAngle for the shortest-path wraparound used on
                        the return leg). Free mouse-look resumes once settled at the top;
                        birdsEyeExitComplete is a one-shot flag GameLoop consumes to flip the
                        phase back to PLAYING once the fly-down finishes.
                        beginTransferAnim/updateTransfer (see Transfer under Engine / rules
                        summary) ease posCol/posRow/posHeight from the old body to the new
                        one over TRANSFER_DELAY_MS via the shared eyeHeightFor helper
                        (also used by resetToPosition); direction/vertical/fov are never
                        touched. `elapsed` accumulates via dt rather than an absolute start
                        timestamp, so it's only called (engine/loop.ts) while phase ===
                        'TRANSFER' and naturally freezes during PAUSED (no pointer lock)
                        instead of needing explicit pause handling.
    input.ts            InputManager — keyboard state, mouse delta, pointer-lock lifecycle.
                        onLockLost fires on both an actual lock loss AND a failed
                        (re)acquisition (pointerlockerror) — callers must not assume
                        "was locked" before reacting.
    loop.ts             GameLoop — per-frame play(), 4 Hz TurnDriver, 1 Hz drain phase via
                        watcher.ts, per-tick meanie phase via meanie.ts, the corpse sweep
                        (finishUnsupportedCorpses, only on a frame that spliced something — a mesh
                        leaving is the one event that can lower a surface; this is where the
                        deferredSpawns queue used to be drained), sun orbit, render, stat callbacks. BIRDSEYE calls
                        cc.updateBirdsEye() instead of updateLook(), and calls
                        completeBirdsEyeExit() once cc.birdsEyeExitComplete flips true.
                        TRANSFER calls cc.updateTransfer(dt) instead of updateLook(), and
                        calls completeTransfer() once it returns true (the glide reached the
                        target) — replacing the old App.svelte setTimeout, the same
                        camera-drives-the-phase pattern as BIRDSEYE.
    picker.ts           pickTarget(camera, sceneData) → discriminated Pick: 'object' (with
                        gameObject back-ref) or 'terrain' ('plane'/'slope'). Skips
                        userData.skipRaycast meshes (the cone overlays). pickAlong(origin,
                        point, sceneData) is the same ray, filters and resolution aimed
                        somewhere the camera isn't pointed yet — the demo bot uses it to
                        test a shot before spending a second of its 1 Hz budget turning to
                        take it. Note this is a stricter question than
                        engine/visibility.ts's: that asks whether any CORNER of a cell is
                        reachable, this is the single centre ray the game actually resolves
                        an action against, and a tree can swallow one while leaving the
                        other open. That gap cost the bot whole landscapes until 2026-08-24
                        — see engine/bot.ts's aimCandidates, which closes it by aiming at the
                        part of the cell the ray does reach rather than at the centre.
    visibility.ts       isCellVisibleFrom(eyePos, …, fromCol?, fromRow?) — raycast LOS.
                        isCellVisible(camera, …) is a thin wrapper. Skips skipRaycast meshes.
    actions.ts          Engine wire-up: builds an ActionContext from sceneData + camera,
                        calls into game/actions.ts for player-driven actions.
                        performEngineAction/performEngineHyperspace are the single entry
                        point behind all three drivers (keyboard, mouse, demo bot):
                        pickTarget -> canPerformAction -> rules -> markActionPerformed,
                        with the cooldown started only on a real effect.
                        performEngineActionOn takes an already-resolved target instead, for
                        the bot: it must compare what the crosshair actually found against
                        what it aimed at, since acting on a blind pick means building on
                        whatever hillside was in the way. Holds
                        handleKeyActions, handleMouseAction, and the DEBUG handleClick.
                        isBirdsEyeTrigger(camera, sceneData, cameraVertical) is the bird's-eye
                        gate — a steep look (>30°) combined with pickTarget() returning null
                        (true empty sky, not just "nothing absorbable"); MainView.svelte
                        checks it before dispatching a PLAYING left-click to handleMouseAction.
    bot.ts              Demo-mode BotDriver (see game.demo) — the engine half of the bot;
                        the decisions live in a game/botWorld.ts BotPlanner, which the
                        constructor takes (defaulting to game/bot.ts's LadderPlanner) so a
                        challenger can be run against the same engine, scene and rules.
                        Snapshots the scene into a BotWorld (the planner's injected view,
                        same pattern as ActionContext), calls the planner's once-per-
                        landscape survey(), caches the per-decision exposure answers behind
                        a shared per-(watcher, cell) line-of-sight cache — used by
                        isWatched, isInSight and ticksUntilSeen alike — and executes the
                        step it gets back. It holds no plan of its own any more; the only
                        planner state it tracks is the intention() key, for the
                        MAX_PLAN_DECISIONS staleness backstop. A virtual *player*, not an AI
                        opponent: it eases the real camera toward its target at
                        TURN_RATE_RAD_PER_SEC (a 180° U-turn in 0.5s) and then calls
                        performEngineAction, so every energy / placement / LOS / 1 Hz
                        cadence rule applies to it exactly as to a human. Planning is
                        omniscient (reads sceneData directly, no fog of war); execution
                        is not. Acts only after SETTLED_FRAMES_REQUIRED = 2 settled
                        frames — Three refreshes camera.matrixWorld inside render(), so
                        an aim set on frame N isn't raycastable until frame N+1, and
                        acting sooner picks along the previous orientation.
                        WHERE IT AIMS is aimCandidates(col,row,startY): every point on a cell the
                        crosshair could sensibly be pointed at, best first, PRE-FLIGHTED with
                        pickAlong so the first shot is one that arrives rather than one discovered
                        to miss a second later. Two shapes — an object is walked up its own
                        silhouette (AIM_FRACTIONS = [0.5, 0.85, 0.2]), bare ground across its own
                        surface (AIM_OFFSETS, corners first at inset 0.4, since corners are what
                        engine/visibility.ts's reachability test believes). BotWorld.canHit answers
                        from the SAME list, which is the load-bearing part: the planner's idea of
                        what can be hit is exactly what the driver can deliver, and while the two
                        disagreed one of them was wrong every time. Both halves were found by
                        watching, 2026-08-24 (PLAN-BOT2.md postscript 9): a tile whose centre sat
                        behind a fold of ground was written off though most of its surface was in
                        plain view (landscape 35, where the opening is tight enough to make it
                        fatal), and canHit's single mid-silhouette ray passed through the HOLLOW in
                        the Meanie model — a head floating over a tripod foot — so the rung that
                        exists to absorb Meanies on sight had never once fired in 1000 landscapes.
                        861 -> 888/1000 on the 6000-6999 block, with EVERY loss bucket down.
                        The failure blacklist clears when the body moves, when an action at that
                        cell succeeds, OR when the object it was recorded against stops being the
                        cell's top object. The second deletes a false invariant: "every
                        reason a step can fail is a function of where we're standing" holds for an
                        aim miss and NOT for a rules refusal, since canPlace turns on the cell's
                        CONTENTS — which the bot rearranges itself (landscape 233: a conservation
                        tree landed on its half-built assault pile, the create was refused, the bot
                        ate that tree a decision later and went on treating its own assault tile as
                        impossible). Measured neutral over 1000 landscapes; fires ~3 times in 60.
                        The third (2026-08-26, postscript 19) says the same thing about the OBJECT
                        rather than the cell: an entry stores what was standing there and expires
                        when a drain morph, a conservation tree or a Meanie conversion replaces it.
                        Identity, not type — a morph produces a new GameObject and objectsAt already
                        drops anything mid-absorb, so it is one reference comparison.
                        And A MISS AGAINST SOMETHING STILL MATERIALISING IS NOT RECORDED AT ALL:
                        the step is dropped and re-proposed next decision. The exact mirror of
                        GameObject.remove()'s skipRaycast — a corpse is gone to the rules while its
                        mesh lingers, a spawning object is present to the rules while its mesh is
                        still growing out of the ground, so a ray at its finished midpoint passes
                        over the model that exists and proves nothing. aimHeightFor re-derives that
                        midpoint from the live scene at EVERY attempt for the same reason
                        (AIM_FRACTIONS[0] is the midpoint, so attempt 0 needs no special case).
                        Landscape 7755, reported from watching: the tree the bot was shooting at
                        became the Meanie hunting it — triggerMeanieConversion and the harvest rung
                        both take the closest tree, so this is the ordinary case, not a coincidence
                        — the shot went over its head, the retries landed inside the conversion's
                        spawn animation, and rung 0b (absorb a Meanie, above everything but the
                        endgame) was gated shut by isBlocked for the five seconds it took the Meanie
                        to force the hyperspace that lost the landscape. 7755 LOST -> WON +19;
                        926 -> 926 on the block (+7/-7, its noise floor).
                        Ticked from
                        GameLoop before the camera block (it writes direction/vertical,
                        updateLook flushes them the same frame). Also owns the demo watchdog:
                        checkWatchdog tracks time since the last action the rules *accepted*
                        (read off game.lastActionAt, which a refused or mis-aimed step
                        deliberately doesn't move) plus a per-landscape ceiling, and on
                        breaching either DEMO_NO_PROGRESS_MS or DEMO_LEVEL_LIMIT_MS calls
                        triggerLost('stalled') so stall and death share one exit path. Its
                        clocks re-seed on game.startCount rather than at construction — a
                        demo restarted on the landscape it was already showing doesn't
                        rebuild the scene, so it keeps the same driver, whose clocks would
                        otherwise still be running from last time and expire at once.
                        Supplies BotWorld.targetJump (game/route.ts) only while
                        game.demo && game.sentinelAbsorbed. D1-D4 done: the bot wins
                        heightGap 0 and 1 landscapes end to end (survey, travel, climb,
                        pile, Sentinel, pedestal, hyperspace) and plays them back to back
                        as an attract mode. Steeper ground still isn't reliable — route
                        steering skips heightGap 3 rather than solving it.
    bot.harness.test.ts Headless bot observatory, and the only practical way to debug the
                        demo: drives the *real* GameLoop over a real scene with real
                        raycasts, stubbing only the renderer (its render() just does the
                        updateMatrixWorld that pickTarget depends on) and the InputManager.
                        Three.js raycasting is pure CPU, so nothing the bot touches needs
                        WebGL or a DOM. Replicates the two MainView effects the bot can't
                        live without — Effect 3a (seat the camera, hide the body from
                        itself) and Effect 3b (start the transfer glide, or updateTransfer
                        never completes and the phase machine wedges in TRANSFER) — and, for
                        the chain case, App.svelte's demo supervisor. Seeds the run from
                        game/demo.svelte.ts's cursor via startDemo(), deliberately leaving
                        settings.levelId elsewhere: if this file ever starts depending on the
                        player's landscape, the demo sandbox has regressed.
                        Reports per-run tallies (steps chosen/failed, aim misses and what
                        the crosshair hit instead, energy floor, objects left);
                        BOT_TRACE=1 dumps every decision, BOT_SECONDS overrides the run
                        length, BOT_LEVELS replays arbitrary landscapes (how a report from
                        watching the demo gets reproduced), BOT_PLANNER picks the strategy
                        and BOT_FRAME_MS the simulated frame time — outcomes on marginal
                        landscapes depend on how the 1 Hz cadence aligns with the 4 Hz
                        drain, so one frame time is one sample. Its wall-clock time is itself a signal — a healthy run is
                        ~1s per landscape, and a bot stuck retrying re-plans every third
                        frame and drags the whole suite to a minute. The BOT_SWEEP=1 sweep
                        plays every landscape with each entry in its PLANNERS list (v1 and
                        v2) and prints a summary per planner: wins, mean jump banked
                        against the mean maxJump those landscapes could have funded
                        (maxJumpOf, a port of utils/all-levels.js pinned by its own test),
                        the trade — which landscapes each planner gained and lost against
                        the first, since two configurations can score the same total while
                        winning different landscapes — and a **loss-bucket histogram**.
                        bucketOf() labels every loss won / died-in-opening / bled-out /
                        never-reached-assault-position / burned-purse /
                        died-after-the-Sentinel / watchdog-stalled / out-of-clock, all from
                        data already logged: game.lostReason, the [energy] spend/gain/drain
                        events, the [bot] watchdog event, and planEndgame's own step labels
                        as a planner-agnostic "did it ever reach a winning position" signal.
                        Diff two histograms rather than two totals — a change that trades one
                        bucket for another at an unchanged win rate is a real finding, and was
                        invisible for the whole of B1-B3. bled-out is a deliberately strict
                        hypothesis bucket (see its comment): treat a low count as evidence
                        against the flee argument, not as a threshold to loosen.
                        Landscapes 106, 600, 246, 16, 35 and 233 are pinned as v2 wins at BOTH 15
                        and 16 ms; 35 and 233 additionally have tests of their own. 35 asserts ZERO
                        aim misses and a MEANIE among the things absorbed (the fixture for
                        engine/bot.ts's aimCandidates rather than for a strategy); 233 asserts the
                        TRANSFER COUNT, because its bug was a busy loop — 34 transfers going nowhere
                        — and a win/loss assertion cannot see one. 7755 (2026-08-26) is the other
                        Meanie fixture and asserts the MECHANISM rather than the win: a MEANIE among
                        the things absorbed, ZERO aim misses, and no meanie-forced-hyperspace at all.
                        Its bug produced a win rate the block could not see (926 either way), so
                        "won" alone would not tell a fixed run from a lucky one.
                        There is a v2 twin of the determinism test — the original runs v1,
                        and v2 latches state where iteration order could leak.
                        BOT_EPOCH is the SECOND SEED AXIS beside BOT_FRAME_MS, added 2026-08-25:
                        game/random.ts seeds from (levelId, levelEpoch), so the epoch decides where every
                        hyperspace lands and every conservation tree appears — one epoch is one sample of
                        a landscape exactly as one frame time is. It exists because a demo that has
                        retried a landscape, or been rewound onto one, is NOT on epoch 0, so a run that
                        fails in the browser can win here at the default and look unreproducible.
                        Landscape 9950 is the case: it wins at epoch 0 and at frame times 14/15/17/18,
                        and loses at epochs 2, 3, 4, 5 and 7. runDemo takes it as a parameter too, since
                        a pinned fixture reproducing such a report has to NAME its epoch rather than
                        inherit the environment's — 9950 is pinned at epoch 7, where at epoch 0 it would
                        assert nothing.
    exposure.harness.test.ts  Validation rig for game/exposure.ts's analytic line of sight
                        against the engine's own raycaster, over real landscapes. The map is
                        only worth anything if the two agree, and the older terrainVisible
                        disagreed by ~20% in the unsafe direction. Samples every (watcher, cell)
                        at five target heights, so it tests the height WINDOW rather than a
                        boolean, and counts the two directions separately: UNSAFE (map says
                        hidden, engine can see — bounded, 0.0064% over 50 landscapes) versus
                        safe-side (map says exposed, engine says hidden — ~2%, mostly object
                        occlusion the terrain-only sweep does not model, and the direction that
                        costs the bot caution rather than its life). EXPOSURE_LEVELS replays a
                        block, EXPOSURE_MARGIN re-runs the SIGHTLINE_MARGIN trade-off table in
                        its header, EXPOSURE_VERBOSE prints per landscape.
                        The unsafe bound is deliberately NOT zero, and the header records why
                        so nobody tries to drive it there: traced on landscape 390, a sightline
                        entering a hill tangentially is missed by the raycaster, after which the
                        ray travels three whole levels INSIDE the hill unregistered — the exit
                        faces are back-facing and flat planes are FrontSide. The same ray cast
                        backwards hits the blocker cleanly. In those cases the ENGINE is the
                        permissive one, and no analytic model reproduces a face-culling artifact.
    exposureSensor.ts   The LIVE half of the exposure map, and the seam that matters: game/
                        exposure.ts is pure and three-free, this owns the once-per-landscape build
                        and turns the engine's live Watcher objects into the snapshots it wants,
                        and exposureOverlay.ts only DRAWS. Anything that needs to KNOW about
                        exposure reads this — so a planner can consume the map without importing a
                        visualisation, and switching the overlay off costs the sensor nothing.
                        ExposureSensor.view(live) returns an ExposureView: the map plus the
                        watchers' clocks resolved once, with cheap per-cell read(col,row,height)
                        and aboveEveryEye(height) on top. Resolving costs a short search per
                        watcher, so doing it once per view is what makes a whole-map sweep (the
                        overlay) and a many-cell decision (a planner) equally cheap. A view is a
                        SNAPSHOT — take a fresh one when the clocks may have moved, i.e. per tick.
                        The build is lazy (~58 ms mean, 233 ms worst): free in the frozen window
                        before the player's first action, but not worth spending on a scene rebuild
                        nobody asks a question of. Owned by SceneData as `exposure`.
                        liveWatchersOf() KEEPS absorbed watchers in the list rather than filtering
                        them: clocksFor matches the map's own list by tile and must see the tile is
                        now empty (-> null clock -> alive:false) rather than have the match fall
                        through to whatever else is standing there.
    exposureSensor.test.ts  What the overlay used to own and no longer does: the map built once and
                        reused across views, the live facing re-syncing without touching it, an
                        absorbed watcher dropping out at READ time rather than by a rebuild, and the
                        above-every-eye ceiling. Plus liveWatchersOf taking watchers and leaving
                        everything else.
    exposureOverlay.ts  Debug visualisation of game/exposure.ts (PLAN-EXPOSURE.md). DRAWING ONLY —
                        it takes an ExposureView from exposureSensor.ts and paints it; it owns no
                        map and no clocks. One small
                        square per FLAT cell floating HOVER_HEIGHT above the ground, on a single
                        InstancedMesh with per-instance colour — one draw call, skipRaycast,
                        Disposer-registered. Toggled by settings.showExposureMap (Settings ->
                        Display -> Show exposure map, debug-gated: it is an oracle, and a player
                        who can see it is not really playing).
                        EVERY TUNING CONSTANT IS EXPORTED IN ONE BLOCK AT THE TOP: SQUARE_SIZE
                        (2/3 cell), HOVER_HEIGHT (0.1), RAMP_HORIZON_TICKS (120 = 30 s) and the
                        HELD_OPACITY and the five colours. Five states, so that "safe" is never one
                        undifferentiated colour: in sight now (red), exposed within the ramp
                        (red->amber->green), exposed but past the horizon (green), no sightline at
                        this height (blue), and at-or-above EVERY live watcher's eye (violet —
                        permanently undrainable, the PLAN-BOT3 "build a tower out of reach" case
                        made visible).
                        Plus one ORTHOGONAL channel: a cell waiting on a HELD turn (its watcher has
                        stopped rotating to eat) keeps its ramp colour and is MARKED rather than
                        recoloured. Colour says WHEN, the marking says WHETHER THE CLOCK IS RUNNING.
                        A held watcher pauses its whole future schedule, so every cell it will ever
                        reach is technically held — the first version flagged them all one dark red,
                        which was correct and useless, since "red once it stops" and "green once it
                        stops" are what a plan is built from. The marking is world-space diagonal
                        HATCHING — gaps cut through the square with discard, so the ground shows
                        through and adjacent held cells form continuous bands, readable at range on
                        any theme. Half-opacity was tried first and rejected: at 0.5 on a saturated
                        theme it mostly read as "slightly darker".
                        InstancedMesh offers no per-instance pattern (colour is per instance, this
                        is material-level), so it arrives as an instanced `held` attribute acted on
                        at the same #include <dithering_fragment> point world/objects/models/
                        index.ts patches, with the world-space stripe coordinate as a second
                        varying. Still one draw call.
                        The material is OPAQUE, not transparent, and that line is load-bearing: it
                        is what fixed a flicker where the squares vanished for a fraction of a
                        second, most often during a body transfer. Transparency put the mesh in the
                        sorted pass, where Three orders by the OBJECT'S ORIGIN depth — world
                        (0,0,0), the map corner, while its instances cover the whole landscape, so
                        the sort key is meaningless and swings as the camera moves, sharing that
                        pass with a transfer's two crossfading bodies and any live particle burst.
                        Since the hatching is cut with discard every surviving fragment is fully
                        opaque, so the opaque pass is also simply where it belongs.
                        frustumCulled = false too (Three caches an InstancedMesh's bounding sphere
                        and never invalidates it — see engine/particles.ts — and this object spans
                        the whole map, so the test can never pay off), and customProgramCacheKey is
                        set because Three's program cache ignores onBeforeCompile, so a material
                        with matching parameters could silently share an unpatched program.
                        polygonOffset was tried against that flicker first and made it WORSE — the
                        artifact tracked the camera, but because transparent draw order depends on
                        camera position, not because depth precision does. Do not re-try it; the
                        hover height is a visual choice, not a workaround. See PLAN-EXPOSURE.md. Opaque by design: the level themes are saturated and vary per
                        landscape, so a translucent overlay would take its hue from the theme and
                        the same exposure would read differently level to level.
                        The ramp horizon is deliberately far shorter than a watcher's 12.8-minute
                        cycle — scaled to the cycle nearly every cell with a sightline would sit
                        mid-gradient and say nothing; scaled to a decision it answers "can I
                        finish what I am doing here before the cone arrives".
                        Repainted on the 4 Hz game tick (engine/loop.ts), never per frame: the
                        watchers' clocks are the only thing that can change a colour. That makes a
                        drain-locked watcher's frozen sector visible for free — its clock stops,
                        so its colours stop with it. MainView's Effect 3e paints once more when the
                        overlay is switched on or the scene rebuilt, since the tick doesn't run in
                        MENU/PAUSED/BIRDSEYE or before the first action — which is exactly when
                        you'd want to study it.
                        ExposureView.read() is the accessor behind BOTH the colouring and MainView's
                        crosshair readout, so the picture and the number cannot drift apart; both
                        go through game/exposure.ts's readExposure().
                        HEIGHT STEPPER: the overlay answers for a body standing on `pileBoulders`
                        boulders (BOULDER_HEIGHT = 0.5, MAX_PILE_BOULDERS = 10), stepped with
                        PageUp/PageDown and Home to reset — named keys, not punctuation, since
                        input.ts tracks KeyboardEvent.key and `,`/`.` move on an AZERTY layout.
                        The squares RISE with it: you are looking at the plane being asked about,
                        and cells flipping blue->red as boulders go under them is the map's height
                        WINDOW made visible, which is the one thing a ground-level picture cannot
                        show. assumedHeight() is the single helper behind the square positions, the
                        colouring and the readout. Handled in engine/loop.ts outside
                        handleKeyActions (no energy, no cooldown) and allowed in BIRDSEYE as well as
                        PLAYING; handleExposureKeys/setExposurePile report whether anything moved
                        and leave the repaint to the caller, which is the one holding a view — and
                        which must repaint, since the 4 Hz tick does not run in BIRDSEYE or before
                        the first action, exactly when someone steps through heights.
                        liveWatchersOf() keeps absorbed watchers IN the list rather than filtering
                        them: clocksFor matches the map's own list by tile, and it must see that
                        the tile is now empty (-> a null clock -> alive:false) rather than have the
                        match fall through to whatever else is standing there.
    exposureOverlay.test.ts  The two things in the overlay that fail SILENTLY. The shader patch is
                        a string replace, so a Three.js chunk rename would no-op it and ghosted
                        cells would render solid, looking exactly like watched ones — the chunk
                        names are asserted against Three's own ShaderLib, and the patch is run over
                        the real ShaderLib.basic source to prove it rewrites something. Plus a
                        headless end-to-end pass (no renderer, no DOM, no WebGL): flat cells get
                        squares and slopes do not, a drain-locked watcher ghosts its pending
                        sectors but NOT the one it is looking at, and an absorbed watcher stops
                        being painted without the map object being rebuilt.
    cones.ts            Watcher view-cone debug overlay — closed wedge geometry, shared
                        material. createConeAssets, attachConeMesh.
    particles.ts        Create/absorb particle burst — 30 tiny cubes on one shared
                        InstancedMesh (one draw call) per burst. createParticleAssets
                        builds the shared cube geometry+material once per buildScene() call
                        (Disposer-registered, same pattern as coneAssets). spawnParticleBurst
                        scatters particles along verticalExtent(mesh) (the object's own
                        bounding-box height, not a guessed constant): 'absorb' starts them on
                        the segment and drifts them outward up to 1 cell over 900ms at a flat,
                        constant pace (no easing — nothing at the far end to mask an eased
                        curve's faster middle section, so any acceleration there reads as a
                        burst rather than a drift) while shrinking to nothing (smokeColors —
                        uniform whitish, type-independent); 'create' is the exact reverse
                        (scattered → converge onto the segment) using an ease-out distance
                        curve instead (1 - easeOutCubic(t), i.e. (1-t)^3 — particles rush in
                        from their scattered start and decelerate into a gentle stop), anchored
                        only across the lower third of the segment (CREATE_ANCHOR_SPAN = 1/3 —
                        the 'squash' spawn animation grows the model from the base up over
                        roughly the same span as the burst, so anchoring across the full
                        eventual height made particles converge into still-empty air above the
                        still-growing silhouette), colored via sampleMeshColors (sampled
                        straight from the object's own merged-mesh vertex-color attribute, so
                        the burst matches whatever's materializing for free). See PLAN.md's
                        Phase 7 for the retuning notes and
                        the frustumCulled=false fix (keypress-triggered bursts were rendered
                        once at their pre-update() identity-matrix pose before Three.js could
                        ever see their real positions, permanently caching a wrong
                        InstancedMesh.boundingSphere and silently culling them thereafter).
                        The burst mesh carries userData.skipRaycast — cosmetic geometry must not
                        answer a rules question. engine/visibility.ts treats any hit it cannot place
                        on a cell as a PURE BLOCKER (that branch exists for visibility.test.ts's
                        synthetic wall), so unflagged these cubes were opaque to watcher detection,
                        the surface rule, meanie LOS and every bot exposure query, while
                        engine/picker.ts ignored them — the crosshair and the sightlines disagreeing,
                        the worst shape a bug can have. Flagged for the CLASS, not the incidence:
                        0.06 cubes against a four-corner-optimistic test make an actual block freak
                        luck, but the positions come from Math.random, so the residue would have been
                        an unreproducible sightline anomaly in a game otherwise seeded to replay
                        exactly. The version that did bite is the absorb animation — see
                        world/objects/base.ts's remove().
                        Both trigger sites additionally check settings.particleEffects
                        (Settings → Game → Particle effects, default on). Triggered from
                        engine/scene.ts's addObjectToScene (gated on time>0, mirroring
                        GameObject's own spawn-animation gate) and removeObjectFromScene;
                        ticked every frame in engine/loop.ts.
    watcher.ts          1 Hz drain phase (Sentinel + Sentry). Per-cell drain target, one atomic
                        morph per drain (scene.ts's replaceObjectInScene — atomic in the RULES, still
                        squash-then-inflate on screen across MORPH_DURATION_MS; see A5b),
                        meanie-conversion trigger, conservation-tree spawn, rotation lock.
                        Owns THE LOCK-ON RULE (see Engine / rules summary): drainPriority()
                        sorts synthoid < boulder < tree then by distance, one exclusive slot
                        per watcher, a WATCHER_GRACE_MS stall on synthoids only, cumulative
                        player drains, and the scan-warning tally it publishes through
                        setScanState().
    watcher.test.ts     The four lock-on rules over the real runDrainPhase on a flat map:
                        priority (a far synthoid before a near boulder — the case distance
                        alone cannot explain), the stall applying to synthoids and not
                        boulders, rotation freezing on draining rather than on locking, and
                        drains cumulating across watchers. Plus the transfer window.
    meanie.test.ts      One Meanie at a time, sweeping not homing, reverting to a tree after a
                        full turn, and testing the SQUARE not the body. That last one needs a
                        wall fixture with tight margins — read its comment before touching it,
                        the first version hid the body too and passed vacuously.
    scene.test.ts       The surface rule matrix (canTargetTopObject) — 15 cases covering what
                        may be absorbed or transferred into, and from where.
    morph.test.ts       THE MORPH WINDOW (A5b) — what a drain does to its target once it has chosen
                        one, which is deliberately not watcher.test.ts's business. One half is the
                        atomic replacement: the rung is kept, the rung below is never promoted, the
                        cell is held because something stands in it, and the two halves play in
                        SEQUENCE (nothing visible from the replacement during the first half) while
                        the pair still takes one drain interval under BOTH animation styles. The other is the corpse rule,
                        asserted the hard way — the reported case is replayed frame by frame and
                        NOTHING may stand on air on any of them. Its standingOnAir() is a second,
                        independent reading of the invariant, deliberately not a call into
                        engine/scene.ts: a test that asks the code under test what the answer is
                        cannot fail. Watch the fixtures — a watcher put on a "hill" a flat test map
                        does not have is itself floating, which is why the Meanie case asserts a
                        height rather than the invariant.
    meanie.ts           triggerMeanieConversion (ONE at a time; closest tree → animated spawn) +
                        runMeaniePhase (per game tick during PLAYING: rotate toward
                        player, on LOS force a hyperspace via drainEnergy + teleport).
    disposer.ts         Disposer class — GPU resource registry, disposeAll(). Registers anything
                        structurally { dispose(): void } rather than a union of three Three.js
                        types: an InstancedMesh owns its instance matrix/colour buffers and needs
                        the same treatment (exposureOverlay.ts).
    platform.ts          Browser/platform plumbing not tied to any one engine subsystem
                        (PLAN-MOBILE.md Phase M0): isTouchCapable() (an interim
                        navigator.maxTouchPoints/ontouchstart heuristic, ahead of Phase
                        M4's real settings.inputMode) and enterFullscreenLandscape()
                        (fullscreens document.documentElement — not just the canvas, since
                        HUD/menu/overlays are canvas siblings — then attempts
                        screen.orientation.lock('landscape'); both failures are swallowed,
                        the portrait fallback overlay covers the rest). navigationUI: 'hide' is
                        what asks Android for the SYSTEM bars — status and navigation — and not
                        merely the browser's chrome. Called from MainMenu.svelte's Play entry and
                        from the tap that resumes a touch demo, and in both cases synchronously
                        inside the gesture handler: requestFullscreen is refused outside one,
                        which is also why an auto-started demo cannot use it at all and the
                        INSTALLED case is the manifest's job instead (display: fullscreen, so a
                        home-screen launch has no bars from the first frame).
                        exitFullscreen() is the way back, guarded on document.fullscreenElement
                        since exitFullscreen() rejects when nothing is fullscreen — the ordinary
                        state for an installed launch, where the missing bars come from the
                        manifest and cannot be undone through this API at all. Needs no gesture,
                        so App.svelte drives it from an effect on PAUSED and thereby covers the
                        tap, the back gesture and a stranded demo alike.
                        setWakeLockWanted() keeps the display awake while the game is on. A
                        standing WANT rather than an acquire/release pair, and that is forced by
                        the API: a wake lock is granted only to a visible document, and the
                        browser releases it ITSELF whenever the page is hidden — so one request
                        at startup silently stops working the first time the app is
                        backgrounded. So the want is re-synced on visibilitychange (listener
                        registered lazily, per the no-side-effects-at-module-load convention),
                        every transition is serialized through a single promise chain so two
                        quick phase changes cannot race into holding two locks, and the want is
                        re-checked AFTER the await in case it flipped while the request was in
                        flight. The 'release' event clears the slot whoever released it, so the
                        next sync knows to ask again. App.svelte decides the want from the phase,
                        with a deliberately different rule for a demo (unattended: hold in every
                        phase but PAUSED) and a person (hold only while playing — their end
                        screens wait on a keypress that may never come).
    touchGestures.ts     Touch input mechanics for the demo's controls (PLAN-MOBILE.md Phase
                        M0.5). Pure and DOM-free on purpose — callers read coordinates off a
                        TouchEvent or PointerEvent and hand them here, so every threshold and
                        the whole of the physics is unit-tested with no browser
                        (touchGestures.test.ts). Two parts.
                        beginTrack/extendTrack/isTap answer "was that a tap?", and the
                        load-bearing detail is that a track records the FURTHEST the finger ever
                        got rather than its net displacement — a drag out and back finishes
                        within a tap's tolerance of its origin, so without it a change of mind
                        mid-drag would resume the demo.
                        Scrubber is the landscape picker's physics, and replaced a
                        swipe-to-step recognizer that was the wrong instrument for the job: a
                        swipe steps by one and an unlocked list runs to hundreds, so choosing
                        cost a gesture per entry. `offset` is a FRACTIONAL index, which is what
                        lets the strip slide continuously under the finger instead of jumping;
                        `index` rounds it only when asked which entry is chosen. Friction is a
                        continuous exponential (FRICTION^(dt/frame)) so a flick travels the same
                        distance at 60 and 120 Hz, velocity is sampled from the last ~80 ms only
                        (averaging the whole gesture would let a slow hunt then a flick come out
                        slow), capped so a frantic flick can't cross a whole journey, zeroed at
                        either end rather than pinned there, and always followed by a snap — a
                        picker resting between two values leaves the choice ambiguous on screen.
                        SCRUB_PX_PER_ENTRY is deliberately BOTH the drag sensitivity and the
                        strip's visual spacing: two different numbers would slide the entries at
                        a rate other than the finger dragging them, which is the thing that
                        reads as broken. begin() zeroes velocity, so grabbing a gliding strip
                        stops it dead rather than letting it drift out from under the touch.
                        No long-press anywhere: reset is a labelled control on the pause overlay,
                        because a resting palm on a flat tablet is a long press and
                        progress-wiping is not something a stray hold should reach.
    fonts/
      Font.ts           Vendored+trimmed from Three.js examples
      TextGeometry.ts   Vendored+trimmed from Three.js examples
      fixed_v01_Regular_minimal.js   Glyph data (only glyphs we use); .d.ts sidecar present
    visibility.test.ts  LOS unit tests (height check, blocker mesh)

  game/                                # Pure game rules — no `three` value imports at runtime
    state.svelte.ts     game phase state machine, energy economy. Functions:
                        startGame/pauseGame/resumeGame/enterDebug/returnToMenu/endGame,
                        beginTransfer/completeTransfer, triggerWon/completeWon,
                        triggerLost/completeLost, giveUp (second-Escape quit from
                        PAUSED), spendEnergy/gainEnergy/drainEnergy,
                        canPerformAction (1 Hz action cadence gate),
                        markFirstAction (watcher dormancy gate),
                        markSentinelAbsorbed (per-level absorb lock),
                        resetProgress (relocks levels, delegates to stats.svelte.ts's
                        resetStats), startDemo/exitDemo/advanceDemo/resetDemoRun.
                        beginLevel() is the shared per-landscape reset, split out of
                        startGame() so the game.demo flag and the stats target can be pinned
                        *before* it runs — it seeds game/random.ts from currentLevelId(),
                        which needs to know who is driving. currentLevelId() is the single
                        answer to "which landscape is being played": the bot's own cursor
                        (game/demo.svelte.ts) while game.demo, the player's settings.levelId
                        otherwise. Every gameplay consumer goes through it — MainView's
                        Effects 2 and 3d, the seed above, both end screens — and the menu
                        deliberately does not, since it steps the player's own unlocked list.
                        advanceDemo() is the demo's win-and-continue: it moves the bot's
                        cursor by the leftover energy and calls startDemo() straight away, so
                        the next landscape begins without a trip through MENU, and it never
                        touches settings or save(). It also records demoProgress.cameFrom and clears
                        the strike count — a win is what has to break "three in a row", not merely
                        moving on.
                        failDemo() is its counterpart and the demo's FAILURE path (2026-08-24,
                        landscape 482). A loss used to call exitDemo() and stop the demo dead, on the
                        argument that skipping a landscape the bot can't win would be cheating and that
                        leaving the cursor put is how its weakest landscape makes itself known. Both
                        halves still hold — they just needed somebody watching, and an unattended run
                        stopped at the first failure and told nobody. Now the landscape is RETRIED IN
                        PLACE and the third consecutive failure blacklists it and rewinds the cursor to
                        cameFrom. The rewind is the load-bearing part, not the list: the landscape it
                        goes back to is one the bot actually won, and route.ts's blacklist check makes
                        that same win buy a DIFFERENT landing, so every landing stays earned and there
                        is no new steering code (planSurplusBurn already did it). A retry MUST bump
                        levelEpoch, for two independent reasons: MainView's Effect 2 rebuilds the scene
                        on it (without a bump the bot restarts on the wreckage it just left) and
                        game/random.ts seeds from (levelId, levelEpoch), so without a bump three strikes
                        would be three copies of ONE run rather than three attempts. A rewind does not
                        bump — the cursor itself moves, and replaying the target from the same seed is
                        the point, since only the steer should differ. cameFrom is cleared ON USE, which
                        bounds the mechanism: a second rewind would need where the TARGET was reached
                        from, which nothing records, so a rewind target must be won again before the
                        chain continues. Two cases hand back to the menu instead, both deliberately: no
                        cameFrom at all (the demo's origin, a fresh reset, or the 9999 wrap — checked
                        BEFORE the strike is counted, since a landscape that can't be rewound away from
                        can't be blacklisted either, and half-counting towards an unreachable verdict is
                        misleading state) and a rewind target that is itself blacklisted.
                        WHAT "hand back" MEANS is the caller's choice (2026-08-25):
                        failDemo({ haltWhenStranded }). Desktop keeps exitDemo() -> MENU; touch
                        passes true and the demo is instead HELD in PAUSED with game.demoHalted
                        set, because the menu it would land in is an arrow-key tree a phone
                        cannot drive and the touch pause already carries the two controls the
                        situation calls for (pick another landscape, reset the run). The policy
                        is an argument rather than an isTouchCapable() call in here — platform
                        questions belong to the UI. PauseOverlay then captions itself "Nowhere
                        Left To Go", since a stranded demo is not a pause anybody asked for, and
                        resumeDemo() treats a stranded resume as a START whatever the stepper
                        names: untouched replays the landscape with a fresh seed (levelEpoch++),
                        moved begins what it names. Resuming IN PLACE is the one forbidden
                        outcome — PAUSED was reached from a loss, so it would restore the scene
                        the bot lost on with the energy it lost with.
                        exitDemo() bumps levelEpoch for the same
                        reason completeLost()/giveUp() do — the landscape the menu orbits
                        behind should be clean, and reverting currentLevelId() only forces a
                        rebuild when the two cursors differ.
                        completeWon() (the player's path only) caps the jump at landscape
                        9999 and skips the unlock step entirely when 9999 itself was just
                        won — there's nowhere further to jump; the demo equivalent wraps its
                        cursor back to 0 instead. triggerWon()/triggerLost() bump
                        victories/deaths through stats.svelte.ts's recorders, so they land on
                        whichever record is playing. triggerLost() takes a reason ('energy',
                        or 'stalled' from the demo watchdog) and stores it in game.lostReason
                        for LoseScreen's caption.
                        enterBirdsEye() (PLAYING → BIRDSEYE) and completeBirdsEyeExit()
                        (BIRDSEYE → PLAYING, called only once the camera's fly-down
                        finishes — see engine/camera.ts) gate the bird's-eye view.
                        completeTransfer() (TRANSFER → PLAYING) is likewise only called once
                        the camera's transfer glide finishes (engine/loop.ts, driven by
                        CameraController.updateTransfer). pauseGame() also accepts BIRDSEYE
                        and TRANSFER as source phases, recording which one in
                        game.pausedFrom ('PLAYING' | 'TRANSFER' — BIRDSEYE maps to
                        'PLAYING', its camera state is already reset to ground by the time
                        pauseGame() runs) so resumeGame() restores the right phase — a
                        still-in-flight transfer glide (frozen while PAUSED, since
                        updateTransfer isn't called without pointer lock) resumes back into
                        TRANSFER rather than PLAYING, so it keeps blocking input until it
                        actually finishes.
    stats.svelte.ts     Lifetime stats, in TWO records of identical shape: `stats` (the
                        player's, localStorage key 'stats') and `demoStats` (the demo bot's,
                        key 'demoStats'), both built by the emptyStats() factory and both
                        loaded by loadStats(). Fields: deaths, victories, transfers,
                        hyperspaceCount (voluntary H-key only — Meanie-forced hyperspace is
                        excluded), absorbed.{tree,sentry,sentinel,meanie} (boulder/synthoid
                        excluded), gameCompletions, and the completedGameThisRun guard (caps
                        gameCompletions at +1 per run even if landscape 9999 is replayed
                        without a reset).
                        setStatsTarget('player'|'demo') picks which record every recorder
                        writes and activeStats() reports; game/state.svelte.ts sets it as a
                        level begins (startGame/startDemo/returnToMenu). EVERY mutation goes
                        through a recorder — recordAbsorb/recordTransfer/recordHyperspace/
                        recordVictory/recordDeath — precisely so that gate has no holes: an
                        unattended attract-mode run would otherwise inflate the player's
                        history, and a demo reaching landscape 9999 would bump their
                        gameCompletions and permanently speed up their watchers.
                        resetStats() clears the current record except gameCompletions, which
                        a "Reset progress" is meant to preserve.
    demo.svelte.ts      The demo bot's own saved progress — levelId (the landscape it plays
                        next) and levelIds (everywhere it has reached), persisted to
                        localStorage key 'demoState' in settings.svelte.ts's load/save shape.
                        The other half of the sandbox described above, and what lets the demo
                        *resume* rather than restart. Data and persistence only, with no
                        import of state.svelte.ts, which imports this — currentLevelId() is
                        where the two meet.
                        Also THE THREE-STRIKE BLACKLIST (2026-08-24): `blacklist` (landscapes
                        failed STRIKES_BEFORE_BLACKLIST = 3 times in a row), `strikes` +
                        `strikeLevelId` (the consecutive count, two scalars rather than a map so
                        "in a row" resets itself the moment the cursor moves) and `cameFrom` (the
                        landscape whose win paid for the current one — what gives a dead end
                        somewhere honest to rewind TO). recordDemoStrike/clearDemoStrikes/
                        blacklistDemoLevel/isDemoBlacklisted are data operations only; the
                        orchestration is state.svelte.ts's failDemo(). loadDemoProgress copies
                        whatever keys the saved JSON has, so an older 'demoState' needs no
                        migration. resetDemoProgress clears the list wholesale — deliberately the
                        ONLY thing that does, since the list is a verdict on THIS bot and an
                        improved one deserves to disagree with all of it.
                        IMPOSSIBLE_LEVELS + isProvenImpossible (2026-08-25) are the deliberate
                        exception: hard-coded landscapes ([482]) a HUMAN proved have no win in
                        them. That is a claim about the game, not about the bot, so there is
                        nothing for a better planner to disagree with — it survives a reset, is
                        not counted as a skip on the menu line, and blacklistDemoLevel refuses
                        to copy it into the earned list (it would then read as this run's
                        discovery and vanish on the next reset while the seed stayed).
                        isDemoBlacklisted returns the UNION, the one place the two are alike,
                        since a landing is refused either way. Seeded because rediscovery is not
                        free: the verdict costs up to three DEMO_LEVEL_LIMIT_MS losses on every
                        fresh device — reported from a tablet stuck on 482 for ten minutes — and
                        failDemo skips the three-strike sampling for these, which is all that can
                        be done about a cursor already parked on one. The bar for an entry is a
                        PROVEN dead end, never a landscape the bot merely keeps losing; that is
                        what the earned list is for, and confusing the two turns today's weakness
                        into a permanent exclusion.
    route.ts            Which landscape the demo plays next. heightGapOf(level) is a port of
                        utils/all-levels.js's heightGap (so the runtime rule and the route
                        CSVs mean the same thing by it); isPlayableLanding(id) rejects a
                        heightGap above 2 (untested seven-boulder piles — just 2497 and 9306)
                        and an enclosed start, where nothing sits below the starting eye so
                        the only legal opening move is the 3-energy hyperspace hatch (372 of
                        the 10000, and line of sight does most of that work — only 20 have no
                        low-enough flat tile at all) — plus, since 2026-08-24, anything on
                        demo.svelte.ts's BLACKLIST. That check sits deliberately OUTSIDE the memo:
                        the two terrain tests are properties of the landscape's geometry, true
                        before the demo starts and free to cache forever, while the blacklist is a
                        property of this run's history and GROWS while the demo plays — caching it
                        would pin a stale "playable" for the session. It also keeps the two claims
                        separable: terrain is a claim about the GAME, the blacklist about the BOT.
                        chooseDemoLanding(from, maxJump) scans
                        DOWNWARD from the furthest affordable jump and stops at the first
                        landing that passes: 96% do, so it averages ~1.04 generateLevel calls
                        (~3 ms) rather than surveying the window. Memoised per id. No
                        precomputed table, so nothing to keep in sync with terrain.ts.
                        Its "nothing playable, take the longest jump anyway" FALLBACK now prefers a
                        non-blacklisted landing, and that is not decoration: at 96% playable the
                        branch was near-unreachable, but the blacklist grows towards it — every
                        rewind returns the bot to the same landscape, whose window loses one more
                        candidate each time round. Landing on a blacklisted landscape from there
                        would earn it three fresh strikes and another rewind to the same place, a
                        loop that ACTS every second so no watchdog limb ever sees it. With
                        genuinely nothing left it logs allLandingsBlacklisted rather than turning a
                        stuck journey into a silent zero. The
                        strategy is "maximise the jump" — deliberately NOT
                        utils/path-no-tower.csv's heightGap-0 route (the bot handles gaps of 1
                        and 2 fine, and that route's 221-hop optimum assumes a maxJump purse
                        the bot never actually reaches). Room is noted for the
                        "fastest/easiest/…" strategy setting; the setting itself is unbuilt.
    actions.ts          performTargetedAction + performHyperspace + pickHyperspaceTile.
                        Operates through an ActionContext interface — engine/actions.ts
                        injects place/remove/visibility callbacks so this module never
                        loads three. Per-action canPlace gate replaces the older
                        spend → place → refund pattern. performHyperspace resolves the LANDING
                        BEFORE the spend (RULES-FIDELITY.md E6) — see the Hyperspace bullet under
                        Engine / rules summary for why an impossible jump is refused rather than
                        billed.
    actions.test.ts     pickHyperspaceTile's ceiling: generous (the body's altitude, boulders
                        included) and absolute (never raised when nothing fits) — two properties
                        that look contradictory and are not. Plus describe('performHyperspace with
                        nowhere to land'), landscape 482 in miniature: a floor-level pocket whose
                        every flat tile is occupied, asserting the refusal charges nothing and
                        places nothing, and that the same fixture with one tile freed still jumps.
                        The premise (pickHyperspaceTile returning null) is asserted inside the
                        test, so the fixture cannot quietly stop being the case it claims to be. Also the choke point for three
                        lifetime stats (stats.svelte.ts): recordAbsorb() on a successful
                        absorb, recordTransfer() on a successful transfer,
                        recordHyperspace() in performHyperspace() (voluntary H-key
                        only, excluding the pedestal/WON path — Meanie-forced hyperspace
                        in engine/meanie.ts is deliberately not counted).
    levelCodes.ts       findLevelByCode(code) — awaits ensureIndexReady() then deciphers the
                        persisted index block-by-block (codeCipher.ts's decipherStream) and
                        stops at the first match, rather than keeping a fully-decoded code->id
                        Map resident for the session: only the ciphertext (indexCipher, same
                        opaque bytes already sitting in localStorage) is cached between lookups,
                        so a heap snapshot taken between — or even mid — lookups never shows more
                        than the single 4-byte block currently being checked, not a permanent
                        plaintext table. ensureIndexReady() is memoized: it loads indexCipher
                        from localStorage if present, or (first-ever visit only) calls
                        buildIndex(), which shards 0..MAX_LEVEL_ID across a pool of
                        codeIndexer.worker.ts instances (one per navigator.hardwareConcurrency)
                        so the full generateLevel sweep runs at full speed off the main thread —
                        no main-thread throttling needed (the old background trickle capped
                        itself at 20 levels/sec, ~8 minutes for the full range, specifically to
                        avoid competing with the render loop; a Worker has no such conflict).
                        The assembled code->id table is cumulative-XOR "ciphered"
                        (codeCipher.ts) before being persisted; the transient plaintext array
                        built during buildIndex() is local to that function and falls out of
                        scope once ciphered. None of this is real security (the generation
                        algorithm is public and the sweep is replayable by anyone in seconds
                        regardless) — it just avoids leaving a readable table sitting around,
                        whether in localStorage or in memory, for a casual look to find.
                        getLevelCode(id) is the cheap single-level lookup MainMenu uses to show
                        "Level: N, code: ...", uncached (one generateLevel() call).
    codeCipher.ts       Pure cumulative-XOR cipher for the persisted code index: each 4-byte
                        PC/ST code is XORed against the previous block's plaintext (the first
                        against a fixed 'SNTL' key). decipherStream() is a generator yielding one
                        decoded code at a time (two small fixed buffers reused across iterations,
                        no growing array) so a consumer can stop at the first match without ever
                        materializing the rest — see findLevelByCode. decipherCodes() (batch,
                        `Array.from(decipherStream(...))`) exists for the cipher/decipher
                        round-trip and tests only. Also the base64<->bytes helpers used to store
                        the cipher output as a single localStorage string.
    codeIndexer.worker.ts  Computes one shard's generateLevel(id).codes['PC/ST'] values in a
                        dedicated Worker; see levelCodes.ts's buildIndex().
    codeCipher.test.ts  Round-trip, "changing one code changes every later block", and
                        decipherStream's stop-early-without-computing-the-rest coverage for the
                        cumulative-XOR chain.
    levelCodes.test.ts  Coverage for ensureIndexReady/findLevelByCode's own orchestration
                        (sharding, persistence, cache-hit-skips-rebuild, case-insensitivity) —
                        stubs Worker/localStorage/navigator and fabricates cheap per-id codes
                        rather than exercising the real (expensive, separately-tested by
                        terrain.test.ts) generateLevel.
    exposure.ts         The exposure map (PLAN-EXPOSURE.md): for every cell, when each watcher
                        will next be able to drain what stands there. Pure and three-free.
                        Built ONCE per landscape by buildExposureMap, in the window before the
                        player's first action where the watchers are frozen — 58 ms mean, 233 ms
                        worst, against a budget with nothing to lose. Then never mutated: a
                        watcher's rotation AND its drain-lock stall are read out of its live
                        clock at query time (resolveClocks derives the mask offset back out of
                        `rot`, so the map self-synchronises and there is no turn counter to
                        drift), which is why there is no incremental update, nothing to
                        invalidate, and no staleness bug class.
                        Stores per (watcher, cell): a 64-bit CONE MASK (bit k = the facing k
                        turns from now covers this cell's bearing — orientation-dependent,
                        height-INdependent, exact) and a HEIGHT WINDOW [minVisibleHeight,
                        eyeY) (orientation-INdependent, height-dependent, analytic). That
                        factorisation is the whole trick: "the cells a watcher can drain in
                        each of its 64 orientations" is ONE line-of-sight sweep intersected
                        with 64 cone masks, never 64 sweeps.
                        The window, not a boolean, because the drain phase tests line of sight
                        to the target's FOOT height (engine/watcher.ts:132) — so a cell hidden
                        at ground level becomes exposed once a pile is built on it, and a pile
                        whose foot reaches the watcher's eye becomes untouchable. Both are
                        invisible to a "is this cell watched" map, and both matter most exactly
                        where the bot builds.
                        Line of sight is an analytic march over the height field, not a raycast,
                        and it returns the threshold NATIVELY: clearing a blocker at sample t
                        needs targetY >= eyeY + (terrain(t) - eyeY)/t, so the threshold is the
                        max over samples — one march, one number, any target height. Faithful to
                        engine/visibility.ts on the two counts the older terrainVisible got
                        wrong (eye at the cell centre WATCHER_EYE_HEIGHT up; any of the four
                        corners reachable, so per-corner minimum). SIGHTLINE_MARGIN = 0.1
                        resolves the model's own uncertainty band towards "exposed"; its value
                        came from a measured trade-off, see the harness.
                        resolveClocks accepts null for a watcher absorbed since the map was built
                        and marks it alive:false — the ONE thing about a landscape that genuinely
                        changes, handled at read time so the map itself stays immutable and the
                        ~58 ms rebuild never lands mid-run.
                        readExposure() returns { ticks, by, inSightNow, held } because "how long
                        until this is watched" has THREE answers that must not collapse into one
                        number. A drain-locked watcher holds its turn while ticksUntilTurn keeps
                        decrementing into negatives, so flooring firstTurn at 0 made the sector it
                        was ABOUT to turn into report 0 ticks — identical to the sector it was
                        actually looking at, which is the opposite situation to stand in. firstTurn
                        now floors at 1, reserving 0 for "the current facing covers this cell", and
                        WatcherClock carries drainLocked so a paused schedule is distinguishable
                        from a merely overdue one. `ticks` stays conservative (earliest it could
                        possibly happen — the lock breaks the moment the watcher runs out of food);
                        only the label says it is paused. Found by watching the overlay, 2026-08-16.
                        game/cone.ts still floors at 0 deliberately: no drain-lock signal, its
                        caller only wants a conservative number, and changing it would move the
                        existing planners for nothing.
                        Same class of bug, found the same way a day later: while a turn is IN FLIGHT
                        (queued or animating) playTick has already reset ticksToTurn to a full
                        period but `rot` is not committed until the animation ends, so the clock is
                        fresh while the facing is stale and the sector being rotated INTO reads a
                        whole period out. WatcherClock.turning (world/objects/watcher.ts's `turning`
                        getter) shifts the schedule by one for the duration: j=1 is arriving now,
                        j=2 inherits j=1's countdown. Both bugs are the same mistake — two fields
                        describing different moments, read as one — which is worth remembering
                        before adding a third signal.
    exposure.test.ts    The cone half against game/cone.ts's independently-verified closed form
                        on open ground (mask build, 64-bit packing, turn-index resolution and
                        read arithmetic in one differential test), the live-facing re-sync, an
                        overdue turn treated as due now, and the height half: a ridge that hides
                        the ground but not a pile built on it, the eye ceiling, and a wall no
                        height sees past.
                        Plus the absorbed-watcher path: a null clock reads as alive:false, the
                        map object is reused untouched, and with every watcher gone the whole
                        landscape reads as permanently safe.
    botWorld.ts         The contract between a planner and the driver, split out of bot.ts
                        (PLAN-BOT2.md B2) so a challenger planner can be written against
                        the same seam without importing the incumbent: BotObject/BotBody/
                        BotStep/BotAction, the BotWorld interface (the ActionContext
                        pattern — line of sight, watcher exposure and cone prediction all
                        arrive as callbacks), and BotPlanner. A planner is a *stateful
                        object*: survey() once per landscape, decide() per 1 Hz decision,
                        and intention()/abandon() purely so the driver can apply its
                        staleness backstop without knowing what the memory looks like.
    botGeometry.ts      The arithmetic and terrain analysis every planner needs, whatever
                        strategy it plays: bouldersToSee/bouldersToOutrank/eyeHeightOn/
                        endgameCost, terrainVisible, computeHopField, findAssaultTile.
                        What is true of *the game* lives here; what a planner has decided
                        to do about it lives in the planner. Also imported by route.ts.
                        PedestalTarget (pedestal col/row/height) is split out of AssaultPlan,
                        which extends it, because canAssaultFrom and planEndgame need only the
                        pedestal — the finish is pedestal-driven, so a planner that has not yet
                        decided where to build can still answer every question the endgame asks
                        (findPedestal is an objects.find and one map read, no LOS sweep).
                        computeHopField takes one goal or MANY (multi-source reverse BFS), and
                        seeds its frontier explicitly rather than by looking the goal up among the
                        flat tiles — a non-flat or out-of-range goal used to yield a one-entry
                        field where every hop count is Infinity and the walk silently degraded to
                        straight-line scoring. Since every edge needs the target under an eye at
                        tileHeight + 1.375 against integer terrain, no edge climbs more than one
                        whole level: a hop count is a level count, which is what lets a
                        band-seeded field read as "levels below the summit".
                        maxClimbBoulders RELAXES EXACTLY THAT PROPERTY (2026-08-25, landscape 86 —
                        PLAN-BOT2.md postscript 18). It defaults to 1 and is byte-identical to the
                        above at that value, so v1 is untouched; v2 passes 3. Above 1 a second kind
                        of edge exists — a tile whose eye clears the target only after a TALLER pile,
                        which is the two-level climb out of a bowl. 86 starts at (12,18) height 4 in a
                        bowl whose entire height-5 rim is SLOPED, so those tiles are not in the graph
                        at all and the nearest flat ground is two levels up: measured pocket of three
                        tiles with no outgoing edge, `connected` false, and a hyperspace on decision
                        ZERO out of a landscape that is comfortably winnable on foot. Meanwhile
                        bouldersToSee(4,6) = 3 and a three-boulder pile there sees twelve flat
                        height-6 tiles, all of them two cheap hops from the band.
                        THE TALL EDGE IS CHARGED A WHOLE TALL_HOP_COST (= MAP_SIZE², larger than any
                        route of cheap edges can total), so a cost is a PAIR — climbs · TALL + hops —
                        and is lexicographic: a walk always outranks a climb, and the tall edge is
                        only ever consulted where nothing cheap reaches. Deliberate, and not a tuning
                        knob: the tall climb is usually SHORTER in energy (one tower against a
                        staircase), so letting it compete on cost would have the bot habitually tower
                        straight up the terrain rather than walk it — a different game, and a duller
                        one to watch in an attract mode.
                        escapeClimb is its companion and the reason the edge is usable rather than
                        merely true: on a tile the cheap edges cannot leave, how tall must the pile be
                        before something BETTER THAN HERE (by the field's own cost, so never a ledge
                        that leads nowhere) comes into view. Without it the walk climbs a pocket the
                        way it climbs everywhere else, with bouldersToOutrank — the smallest rung that
                        lifts the feet, which is right only where the terrain supplies the other half
                        of the level. On flat ground each rung must out-rank the last from the same
                        floor: 1, then 2, then 3 boulders, an arithmetic series against a purse that
                        only recovers the rung behind it. Returns 0 whenever the tile has a cheap edge,
                        so the ordinary case never sees it.
                        assaultCandidates (every flat tile scored by the pile it needs, row-major
                        and stable-sort-critical) + assaultBand (the subset whose pile-top eye can
                        see the pedestal TOP by terrain alone, bounded by MAX_ASSAULT_BOULDERS = 5
                        = heightGap 2) are v2's survey inputs. findAssaultTile takes an
                        AssaultSearch options object (exclude / candidates / from / sightlines /
                        prefer); every v1 call site passes one argument, so v1 is untouched.
                        `prefer` is the exposure gate added 2026-08-24: the assault tile is the LARGEST
                        commitment in a run — up to five boulders and a body, six seconds of the 1 Hz
                        cadence — and it was the one destination chosen with no reference to watchers
                        at all, while the ordinary walk two rungs below refuses a tile a cone is on
                        outright. Measured at 9% of adopted assault piles standing somewhere that would
                        be watched before the pile could be finished, against 1% for the graded walk.
                        Consulted only AFTER the sightline test and never used to sort — grading is a
                        line-of-sight sweep per watcher per tile and the candidate list runs to the
                        hundreds — and it falls back to the refused tile when every viable one is
                        watched, so it can change WHICH tile is aimed at but never whether there is one.
                        Declared structurally rather than importing TilePreference (botMovement imports
                        this module, not the other way round), which also states the narrower contract:
                        only `avoid` is read, never `reject`. The sightlines
                        cache is sound for a whole landscape because a tile's view of the pedestal
                        top depends only on the height map.
    cone.ts             Watcher cone prediction, pure (PLAN-BOT2.md B1). The cone is 20 of
                        the 256 rotation units wide and every watcher steps ±20 units per
                        period, so a cone advances by exactly its own width each turn —
                        adjacent sectors, no overlap and no gap — which makes the full
                        future schedule closed-form rather than something to simulate.
                        bearingUnits/coversBearing/ticksUntilBearingCovered; engine/bot.ts
                        pairs them with a line-of-sight test to answer
                        BotWorld.ticksUntilSeen. Two documented approximations, both erring
                        towards predicting exposure early: a drain-locked watcher's clock
                        is assumed to run, and `rot` commits ~2 ticks after the turn fires.
    botMovement.ts      How the bot moves, shared by every planner: the BotPlan intention,
                        isPlanViable, planStep, chooseDestination and its candidate
                        scoring. Not strategy — it is what the game makes possible (a tile
                        above the eye can never be targeted, so height is only ever gained
                        by piling boulders and transferring up). What a planner *does*
                        choose is where it would rather stand, which arrives as a
                        TilePreference: v1 grades by present exposure, v2 by how long the
                        cover lasts.
                        PILES ARE SIZED TO THE PURSE (affordablePile, 2026-08-25, landscape 7398): the
                        boulder count chooseDestination returns is capped at what remains once the body
                        on top is funded, so if boulder + synthoid cannot both be paid for the hop
                        carries no boulder. 7398's opening needs a three-boulder tower, leaving 1
                        energy; the bot transfers up, reclaims the body it left (+3) and with FOUR in
                        hand plans a hop costing FIVE — lays the boulder, is left with two, and stops
                        for the rest of the run. Permanent: nothing clears this.plan, the harvest has
                        nothing in reach, and rung 6's hyperspace needs HYPERSPACE_COST + SYNTHOID = 6,
                        so it cannot even leave. NOTE WHY THE OBVIOUS GATE IS NOT THE FIX: the walk
                        prices only the NEXT action (the landscape-16 mistake rungs 3b and 4b use
                        remainingHopCost to avoid), but pricing the whole hop here would only swap one
                        stall for another — at four energy EVERY hop with a boulder in it is
                        unaffordable, so refusing them all stalls just as hard. A cheaper hop was the
                        only answer. Also NOT postscript 8's rejected change, which dropped the climb
                        boulder on GEOMETRY (destination above our feet) on every hop and paid for a
                        better opening out of the ascent; this fires on SOLVENCY and is invisible
                        whenever the bot has money. `budget` is optional so v1 is untouched — the same
                        pattern isPlanViable's `prefer` uses, and v1 still loses 7398 in one transfer.
                        ONLY THE DISCRETIONARY BOULDER IS DROPPED — the Math.max(1, ...) climb floor,
                        which fires when bouldersToOutrank already returns 0 (the destination is at or
                        above our feet and the terrain is doing the climbing). Everything
                        bouldersToOutrank asks for is STRUCTURAL and kept even when unaffordable, since
                        the harvest tops up. Two wrong versions were measured first, both caught on
                        landscape 6313 and both recorded in the function: SHORTENING a pile makes it
                        gain nothing at all (every count below bouldersToOutrank tops out at or under
                        our own height — 6313 spent 8 energy on a tower exactly level with itself and
                        arrived broke in a pocket), and DROPPING it turns a climb into a fall (the same
                        destination lies two levels below, so the bot fell into a tile with no
                        hop-field entry and proposed a hyperspace the rules refused 59 times).
                        912 -> 919 on the verdict block (+8 -1), mean jump unchanged, watchdog-stalled
                        unchanged. The incoherent shorten-the-pile version scores 924 and is REJECTED
                        ANYWAY — it wins by spending less per hop rather than climbing better
                        (never-reached-assault 49 -> 32 bought with watchdog-stalled 14 -> 25), on a
                        mechanism that is wrong on every individual landscape. See PLAN-BOT2.md
                        postscript 16, including what those five extra landscapes are probably telling
                        us and the next thing to try.
                        INSIDE A POCKET, "NEARER THE GOAL" IS A FALSE GRADIENT (2026-08-25, landscapes
                        6161 and 6150 — PLAN-BOT2.md postscript 18). chooseDestination's pass-1
                        `improves` is lexicographic — fewer hops, OR the same hops and a whole cell
                        nearer — and the distance half is dropped while the body stands somewhere no
                        cheap hop leaves (`stuckHere`: a tall-tier cost, cheap to test, then
                        escapeClimb > 1 to confirm). Nothing but the climb changes the cost down there,
                        so "nearer the goal" is nearer to something no walk reaches, bought with the
                        purse the only real move needs. On 6161 the bot opened with a ONE-boulder
                        lateral hop across the pit floor and arrived with 8 energy against the 9 the
                        escape then needed, then laid 42 boulders and absorbed 37 for two transfers.
                        THE RUNG THIS LOOKED LIKE IT NEEDED ALREADY EXISTED: rung 6's "boxed in —
                        hyperspace out" stuck counter (bot2.ts, STUCK_BEFORE_JUMPING) never
                        accumulated, because the shuffle returned a step every second and churn reads
                        as progress to every measurement the harness takes. A churn detector was
                        specified and proved unnecessary — removing the fake progress was the fix, and
                        6150 (a genuinely dead bowl, confirmed by playing it) then wins BY hyperspacing
                        while 6161 wins on foot, from one change. Also measured and DELETED: gating the
                        escape pile on whether its seat can be reached. world.canHit is the real
                        crosshair and right at execution time, but at PLAN time the pile does not exist
                        so the ray flies through empty air — gating on it refused every escape; and
                        terrainVisible refuses when the eye is at or below the target, which an escape
                        seat usually is (a pile is entered by its SIDE, not its top face). The
                        geometrically correct version, running the ray from seat back down to eye,
                        measured 921 (+6/-6) against 926 without it.
    botEndgame.ts       The finish, shared: inAssaultPosition, planEndgame (Sentinel ->
                        body on the pedestal -> transfer -> surplus burn -> hyperspace) and
                        route steering's planSurplusBurn. However a planner gets to the
                        assault tile, the last five actions are identical and unforgiving —
                        absorption locks the instant the Sentinel goes.
    bot.ts              The v1 planner: a priority ladder, pure and three-free, plus
                        LadderPlanner (the BotPlanner wrapper that holds its plan and its
                        survey). Testable against a synthetic landscape with no renderer.
                        planNextStep() is a priority ladder — endgame, transfer onward,
                        reclaim the body just left (+3), take any Sentry in range, harvest
                        to cover endgameCost, else walk — returning a BotDecision: the
                        action to take now, plus the BotPlan it means to be pursuing next
                        tick. planSurplusBurn() is the tail of the endgame rung and the
                        planner's half of route steering: standing on the pedestal with the
                        purse final, it spends the difference between the affordable jump and
                        BotWorld.targetJump (game/route.ts, injected by the driver) on creates,
                        which are never refunded once absorption locks — biggest denomination
                        first, since each costs a whole second of the 1 Hz cadence. Null
                        targetJump means don't steer, which is every non-demo run. If nothing
                        can be placed it wins and overshoots rather than standing there.
                        LadderPlanner holds that plan between decisions; the ladder
                        functions themselves stay pure and take it as an argument. The plan
                        machinery below (BotPlan, isPlanViable, planStep, chooseDestination)
                        now lives in game/botMovement.ts, shared with v2.
                        A plan is an INTENTION ("occupy tile T standing on N boulders"), not
                        a recorded list of actions: the next action is re-derived from it
                        every tick, so a boulder a watcher steals mid-sequence is simply
                        rebuilt where a script would march on. It exists because deciding
                        afresh each tick means inferring past intent from present world
                        state, and the world does not record intent — boulders on a tile are
                        equally a pile being built or one half eaten. Every loop of note came
                        from that gap, and each was patched with a heuristic constant until
                        the plan replaced them (COMMITMENT and the halfBuilt scoring bonus
                        are both gone). isPlanViable() holds the give-up conditions:
                        achieved, fouled by a drain, overbuilt, out of reach, out of sight,
                        or already refused by the crosshair — that last one matters, since
                        commitment without it is stubbornness, pinning the bot to a tile it
                        has proved it cannot hit. Staleness is the driver's job
                        (MAX_PLAN_DECISIONS): a watcher eating a pile as fast as it is laid
                        looks tick-by-tick exactly like progress, so only elapsed time
                        reveals it.
                        The last rung is a hyperspace: with nothing else affordable or
                        legal the bot jumps out rather than stand still. That is a real
                        position, not a safety net — on the map's floor with every
                        neighbour higher there is no legal move at all, since nothing above
                        the eye can be targeted and absorbing needs the same clearance.
                        Every rung that targets an object must honour isBlocked: the
                        transfer rung didn't, so a Synthoid whose midriff sat behind a tree
                        was re-chosen every decision forever, the bot aiming at the obstacle
                        and never moving again.
                        The endgame rung (absorb the Sentinel -> body onto the pedestal ->
                        transfer -> hyperspace, which game/actions.ts turns into the win)
                        takes over once inAssaultPosition(), and MUST stay in charge for the
                        rest of the run once game.sentinelAbsorbed: otherwise stepping onto
                        the pedestal stops counting as "in position", the walk takes back
                        over and transfers the bot straight off it, one action from winning. The
                        transfer rung MUST outrank the reclaim rung: game.previousSynthoid
                        Col/Row is never cleared, so a cell the bot once left stays flagged
                        as "a body of ours" forever, and reclaiming first made it build a
                        body at its destination then immediately absorb it as though it
                        were the old one, forever.
                        computeHopField() is the navigator: a reverse BFS from the assault
                        tile over every flat tile, edges tested with terrainVisible() — a
                        cheap analytic line of sight over the height map alone (no scene,
                        no raycast), which is the only reason an O(tiles²) sweep is
                        affordable. Built once per landscape by the driver. Destinations
                        are then scored lexicographically by (hops, distance): hops alone
                        stops the bot strolling into a pocket that is near the goal but not
                        connected to it (the old straight-line greedy did exactly that,
                        then looped until the Sentinel killed it), while the distance
                        tiebreak keeps it moving within a hop band — on open ground every
                        tile in sight of the goal is 1 hop away, so hops alone would accept
                        only the goal tile and freeze the moment it was watched.
                        bouldersToSee(tileHeight, targetHeight) is the geometry the whole
                        movement model rests on: engine/visibility.ts refuses any target
                        at or above the eye, so a tile higher than the bot's feet can
                        never be aimed at, and height is only ever gained by piling
                        boulders on a tile already in view (bouldersToOutrank). The same
                        formula against the pedestal top reproduces utils/all-levels.js's
                        n = 2*gap + 1 pile rule. bouldersToOutrank returns the SMALLEST
                        pile that lifts the feet above our own: one boulder too many puts
                        the new body above our eye line, where it can't be seen and so
                        can't be transferred into — 3 energy spent on an unreachable body.
                        Zero is a valid answer (a tile already above our feet is a climb by
                        itself).
    bot2.ts             The v2 planner (PhasePlanner), built from the human strategy that
                        completed the game — see PLAN-BOT2.md.
                        CHOOSETRANSFER REASONS IN HOPS, NOT STRAIGHT LINES (2026-08-25, landscape
                        9950). Its `closer` test compared distance(o, assault) against
                        distance(body, assault) — raw straight-line, with no notion of whether the tile
                        connects to anything. On 9950 a pit sat 5 cells from the pedestal against the
                        assault tile's 10 and had NO HOP-FIELD ENTRY AT ALL (from an eye 1.375 above the
                        floor every rim tile's top is overhead, so nothing walks out), so a body
                        abandoned there was permanently "closer" and permanently useless: the bot
                        climbed the ladder to hops 0, transferred DOWN into the hole, hyperspaced out,
                        climbed back, twice, then ground out the clock. Reported as "it insists on
                        transferring to an abandoned synthoid at the bottom of a pit", which is exactly
                        what it is. THE SAME MISTAKE computeHopField WAS BUILT TO FIX IN THE WALK — see
                        chooseDestination's comment about "strolling into a pocket that is near the goal
                        but not connected to it" — in the one rung that never learned it. Now
                        lexicographic (hops, distance) against the same field the walk uses (the band
                        ladder while climbing, the route home once a perch is held), so an unreachable
                        tile is Infinity and never beats anywhere the bot can stand, while the
                        straight-line tiebreak still moves it within a hop band. 909 -> 912 on the
                        verdict block, gaining 6533/6567/6573 and losing nothing, mean jump unchanged,
                        three buckets down and none worse.
                        THE GO-HOME RUNG (2026-08-24, landscape 7632): off the perch with the errand
                        list empty, transfer into the body standing on the perch. It exists because
                        rung 1 cannot do it — chooseTransfer filters out previousBody to stop a
                        two-body oscillation, and THE PERCH *IS* previousBody whenever the bot went
                        out to an errand destination it transferred into, while rung 2 protects that
                        same body as the way back up and the walk cannot rebuild a way home because
                        the perch tile is occupied by the very body it wants. Nothing but a transfer
                        clears previousBody (game.previousSynthoidCol/Row is never cleared), so the
                        state is PERMANENT and deterministic — 7632 failed three times identically,
                        with seven Sentries absorbed and 37 energy against a maxJump of 44. Two rules
                        that are each correct, in the wrong order: chooseTransfer's own comment
                        already lists "the perch we are coming home to" as a reason to transfer, and
                        the filter simply runs before the predicate. PLACED AFTER THE HARVEST
                        DELIBERATELY, not as an exemption inside that filter: at rung 1 the outbound
                        leg of a perch/body pair can be taken on o.height > body.height while the
                        return leg is always allowed by goingHome, so the two are a cycle with no
                        asymmetry to break it — which is what the filter is for. After the harvest
                        has declined and the errand list is empty there is nothing to oscillate
                        with, and the finish is taken on the next decision. Falls through to the walk
                        when a watcher has eaten the perch body (the tile is empty, so building on it
                        works) or the crosshair cannot reach it. Measured byte-identical on the
                        verdict block — 909, same buckets, same 91 losses, nothing flipped — as
                        PREDICTED: all fifteen watchdog-stalled losses there idle in ASCEND, so this
                        deadlock occurs nowhere in 6000-6999, which is why no win-rate measurement
                        could have found it.
                        RUNG 3C, FINISH UNDER A DRAIN (2026-08-24, reported from watching): on the
                        perch and in a watcher's sight, absorb the Sentinel instead of harvesting.
                        THE PURSE CANNOT GROW WHILE A WATCHER IS DRAINING YOU — a tree is +1 against
                        -1 a second, and a draining watcher never rotates away (drainLocked) — so
                        grazing there is not slow progress towards a bigger jump but exactly zero,
                        and negative once a second watcher joins. No threshold to tune. Worse, every
                        drain spawns a conservation tree, so the watcher restocks the shelf being
                        eaten from: HARVEST_BUDGET's comment names this loop and treats 80 decisions
                        as an adequate backstop, which on flat ground is the only thing that ever
                        ends it — 80 seconds of the 1 Hz cadence, most of DEMO_LEVEL_LIMIT_MS, so a
                        landscape already won is recorded out-of-clock and now blacklisted on the
                        third run. It is the rule rung 3b already STATED ("from the perch the answer
                        to being seen is to finish, not to wander") with only the not-wandering half
                        implemented. Fires for EXACTLY ONE DECISION per landscape: its first step is
                        always 'absorb the Sentinel', and that lands sentinelAbsorbed, which hands
                        the run to the unconditional guard at the top of decide() — a one-shot
                        trigger pulling the finish forward, not a second regime beside the harvest.
                        Not gated on affording the endgame (grazing cannot make us richer, and the
                        Sentinel is +4 and stops that watcher for good), and scoped to standing ON
                        the perch, since planEndgame does not test reachability and firing it
                        elsewhere would aim at a pedestal the bot cannot see. Measured 908 -> 909 on
                        the verdict block with every bucket flat and mean jump 35.6 -> 35.3: THE
                        AGGREGATE DID NOT MOVE, and out-of-clock stayed at 8, so the standoff was
                        not costing landscapes on that block. Kept for removing an
                        unbounded-in-principle loop at a small bounded price, not as a win-rate
                        change — see PLAN-BOT2.md postscript 13.
                        THE AIM NEVER NAMES THE TILE UNDERFOOT. aimAt is re-derived every decision and
                        tie-broken by nearest-to-the-body, so the tile being stood on could win it —
                        and control only reaches that line uncommitted, i.e. canAssaultFrom has just
                        refused that tile. A tile you stand on but cannot assault from is the one
                        place height can never be gained (the movement model builds on ANOTHER tile
                        and transfers up; isPlanViable reads a plan on the current tile as achieved),
                        so every rung deadlocks and the ladder hyperspaces out on a full purse. Worse,
                        the body left there makes it a LOOP: climb back, transfer onward into that
                        body, arrive on the dead-end tile again — which is why it escapes only when a
                        watcher eventually eats it. Excluded from the navigation aim ONLY, never from
                        the commit gate above, which must see the current tile or the bot would arrive
                        on the one viable assault tile with its pile built and refuse to commit.
                        Landscape 233, reported from watching: LOST at 34 transfers -> WON +21 at 9,
                        and 888 -> 898/1000 with out-of-clock 27 -> 16 (a busy loop keeps
                        lastActionAt moving, so only the elapsed-time watchdog limb ever sees it). Three differences from v1
                        and everything else shared: it plays in *phases* (secure the high
                        ground, clear the Sentries, harvest everything, then finish) rather
                        than one interleaved ladder; it grades tiles by predicted cover
                        (game/cone.ts) instead of present exposure, applied only to rank
                        tiles it was walking to anyway; and it keeps a **perch** — once
                        standing on the assault tile it holds that position for the rest of
                        the landscape, branching out to collect what's left and transferring
                        back up. (Transfer is the one action that can go upward: the
                        crosshair resolves a Synthoid above the eye where nothing else may
                        be targeted, so the body left on the pile is a ladder home.) The
                        harvest phase is the point: the jump you win is the energy left
                        over, and v1 stopped banking as soon as the endgame was affordable.
                        Since B4 (PLAN-BOT2.md) it also **commits by arriving**. survey() picks
                        NO assault tile: it finds the pedestal, computes the assault band, and
                        seeds one hop field from the whole band — a ladder to anywhere worth
                        arriving, which is why it needs no rebuilding and no retry. An *aim* is
                        re-derived every decision (aimAt, cheap via the cached sightlines), and
                        this.assault is set exactly once, to the tile under the bot's feet, the
                        first time canAssaultFrom accepts. So the tile is reachable because the
                        bot walked there. What that DELETED, and must not come back: the survey's
                        reachable-goal retry (rejectedTiles/MAX_RESURVEYS), the re-point, the
                        never-wired resurvey path, and the latched `phase` field — Phase is now a
                        readout derived per decision by phaseOf() (ASCEND/HARVEST/RETURN/FINISH;
                        CLEAR is gone, it only meant "this decision absorbed a Sentry"), and
                        intention() is keyed on committed-or-not plus the plan cell rather than on
                        the phase, because HARVEST and RETURN alternate freely and a flickering key
                        silently resets the driver's staleness backstop. this.assault is null for
                        the whole climb, so reachable()'s reserved, nextErrand and rung 2b all read
                        it defensively; only the pedestal is fatal to lack. ASCEND_BUDGET bounds
                        the aim's band restriction; lastResort() hyperspaces when no tile anywhere
                        can see the pedestal top, where the old guard returned null forever.
                        Two things B4 measured and did NOT keep, both recorded in BOT.md's
                        rejected table because they read as obvious improvements: freeing the
                        harvest walk from the assault-tile hop field (22/102 against 51 — the
                        confinement is accidentally standing in for a route home the movement
                        model lacks), and replacing the cut-off hatch with a no-height-gained test
                        (177/250 against 182 — a tall pile legitimately spends six or seven
                        decisions before it lifts anything). The cut-off hatch therefore stays,
                        but its meaning changed: band-seeded, !connected now means no route to
                        anywhere the Sentinel could be taken from.
                        Rung 3b, the **move-on** rung (2026-08-15, reported from watching): while in
                        sight and not yet perched, take the step the walk would have returned at rung
                        5 anyway, one rung earlier. Absorbing outranks walking, so with a tree in
                        reach and the purse low the bot always ate rather than moved — and since a
                        draining watcher never rotates away (drainLocked), one point in against one
                        point out is an equilibrium with no exit. NOT the flee rung, which has
                        measured negative six times: that one fires on cone contact and *adds* a
                        journey, this one adds nothing and falls through to the harvest unchanged
                        when the walk has nowhere to go. +6/250 and +16/1000, bled-out 17 -> 4,
                        while reading -3 on the 102 training set. It prices FINISHING the hop
                        (remainingHopCost) rather than the next action, and the drain taken while
                        making it is part of that price: paying action by action cost landscape 16,
                        where the bot laid a boulder under a cone at 7 energy, was drained, built the
                        body, and died one action short of a transfer it had already paid 5 for.
                        Priced on what REMAINS, not the whole hop — charging the full price every
                        decision refuses a half-paid hop and re-creates the grazing loop the rung
                        exists to close. 16 is pinned in the harness at both frame times.
                        Rung 2 reclaims **boulders as well as the body** at the cell just left. It
                        tested top.type === SYNTHOID, so once the body was absorbed the boulder under
                        it stood there forever and every hop ran at a net -2 (boulder 2 + body 3,
                        reclaim +3) — the rung's own comment claimed the walk cost "nothing net" and
                        it never had. Reported from a demo dying on landscape 16 with five boulders
                        abandoned against a maxJump of 22. +11/1000, purse ratio 78% -> 80%. Note the
                        geometry that bounds it: the body is hittable because it stands ON the
                        boulder, so absorbing it drops the boulder half a level and it can fall
                        behind the ridge the hop crossed — canHit then refuses, and the rung
                        correctly declines rather than looping.
                        The hyperspace rungs are guarded three ways, all from landscape 35, where the
                        bot jumped at energy 9 and was stranded at 2 four jumps later: it waits
                        STUCK_BEFORE_JUMPING = 3 consecutive dead decisions (one is transient — a cone
                        crossing the only tile, a body still materialising); it requires
                        energy >= HYPERSPACE_COST + SYNTHOID so it can still act on landing; and it
                        charges a hatch jump per LANDING rather than per proposal, since the 1 Hz
                        cadence refuses plenty and three refusals from one tile used to spend the whole
                        three-jump allowance without moving.
                        NOT done, and deliberately: making chooseDestination's speculative climb
                        boulder conditional on affordability. It scores +3/1000 and reads like a win,
                        but never-reached-assault-position goes 123 -> 150 with it — the gain is bought
                        in the opening and paid for out of the ascent, and the bot visibly climbs in
                        two steps where it climbed in one. Reverted; see PLAN-BOT2.md postscript 8,
                        which also records the plausible-but-false explanation that the boulder is an
                        aim anchor (it is not: one create per hop aims at bare terrain either way).
                        isPlanViable also takes an optional TilePreference now (v2 passes one, v1
                        does not, so v1 is untouched): a plan is dropped when a cone arrives on its
                        destination, graded against the boulders REMAINING rather than the original
                        pile. Measured exactly neutral — 188/250 with and without — and kept only
                        because it closes an unbounded leak for no measurable cost. It fires late by
                        construction (when the cone arrives, after the boulders are paid for); doing
                        better needs the exposure map (PLAN-EXPOSURE.md).
    botPlanners.ts      createPlanner(id) — the one place that knows both planners exist,
                        so nothing else imports a planner it isn't using. Selected by
                        settings.botPlanner (Settings -> Game -> Demo bot, debug-gated) and
                        by BOT_PLANNER in the harness.
    bot.test.ts         Planner coverage on synthetic landscapes: pile arithmetic vs the
                        utils/ formulas, assault-tile choice and its LOS rejection, the
                        never-hop-upward rule, watcher-shadow preference and its budget,
                        each rung of the ladder, the endgame sequence, and route steering's
                        surplus burn (denomination choice and step-down, no-surplus and
                        no-target cases, and winning anyway when nothing can be placed).
    bot2.test.ts        What makes v2 v2, on synthetic landscapes: cover graded by time
                        rather than by "is anything looking now", the phase split (climb
                        before banking, top up when it cannot afford to move, harvest from
                        the perch even with the endgame already affordable), value-ordered
                        harvesting, finishing once the landscape is picked clean, and the
                        two perch rules — never eat the body left on the pile, and go home
                        to it rather than treating it as just another body.
                        Plus B4's describe('committing by arriving'), which is the only place the
                        deferred commitment is observable: survey leaves committedTile() null and
                        the bot climbs anyway, it stays null while too low however good the tile
                        looks, it becomes the tile underfoot the moment canAssaultFrom accepts,
                        and a world where nothing can see the pedestal top hyperspaces instead of
                        idling. committedTile() exists as a read-only accessor precisely so those
                        can be asserted positively: the test this file used to carry for the
                        (never-wired) re-survey asserted only that a step's label was NOT
                        'clear the assault tile', which passed identically with the mechanism,
                        without it, or with it inverted. A negative assertion about a label, with
                        nothing positive about the behaviour in the title, is not a test.
                        Plus describe('finishing under a drain') for rung 3c — the deliberate pair to
                        'harvests from the perch even with the endgame already affordable': same
                        world, same reachable tree, opposite answer once the perch is in sight. Both
                        positive cases fail without the rung (verified by removing it). The scope case
                        asserts POSITIVELY that it keeps harvesting off the perch rather than merely
                        not finishing — a bare not.toBe there would pass with the rung, without it, or
                        with it inverted, which is the trap this file's own B4 note records.
                        Plus the two go-home cases in describe('the perch'): the deadlock world is
                        the existing 'never eats the body it left standing on the pile' world plus the
                        one field that caused it (previousBody pointing at the perch), and the
                        fall-through asserts the ladder still produces a move when the perch body has
                        been eaten — deliberately NOT which move, since it rebuilds via a neighbouring
                        tile (the pile top is already above the eye from there) and pinning that tile
                        would pin the fixture's geometry rather than the rung.
                        Plus the hop-based transfer case, whose FIXTURE DESIGN is the lesson: both
                        first attempts were vacuous and both are commented in place. chooseTransfer takes
                        the FIRST candidate satisfying its predicate, so listing the pit after the perch
                        body let goingHome answer first and the case passed with the rule fixed, broken
                        or inverted; and `closer` measures distance to the ASSAULT TILE, not the
                        pedestal, so a pit placed near the pedestal was not closer at all and the old
                        code declined it for the right answer by accident. Caught by removing the fix and
                        checking the test went red.
                        Plus describe('sizing the pile to the purse') for landscape 7398: the boulder
                        dropped when boulder + body cannot both be paid for, KEPT when the purse can
                        fund it (a solvency rule must be invisible when there is money), and the pile
                        left alone when no budget is passed — which is what pins v1 being untouched.
    cone.test.ts        The cone schedule. Its load-bearing case sweeps a 13x13
                        neighbourhood at all 256 facings and cross-checks the pure
                        unit-space predicate against engine/watcher.ts's own inWatcherCone,
                        excluding only the exact-edge tie (every cardinally-aligned cell at
                        the right facing, decided by float rounding inside Vector3.angleTo)
                        — and asserting separately that the predictor is never *less*
                        cautious than the engine.
    route.test.ts       heightGapOf against utils/all.csv's own column (including the two
                        gap-3 landscapes), isPlayableLanding's acceptances (0/1/2/272/9999 —
                        the landscapes bot.harness.test.ts asserts wins on) and rejections
                        (15/23/190/200, enclosed starts), and chooseDemoLanding's maximise /
                        step-down / land-exactly-on-9999 / nothing-to-steer-to behaviour.
                        Plus describe('steering around the blacklist'): a blacklisted landscape the
                        TERRAIN tests accept (so the rejection can only have come from the list),
                        one blacklisted after the memo was already populated, the jump stepping
                        down past it, and the fallback. That last case has to be built out of BOTH
                        kinds of rejection — every candidate failing isPlayableLanding while at
                        least one is not blacklisted — or the primary loop answers it and it tests
                        nothing; it also has to put the surviving candidate somewhere other than
                        `reach`, or it passes against the old unconditional fallback too. Both
                        traps were hit while writing it.
    random.ts           Seeded PRNG (mulberry32) for gameplay randomness — which tile a
                        hyperspace lands on, where a conservation tree appears, object
                        rotations. Reseeded per landscape from currentLevelId() +
                        game.levelEpoch, so a landscape plays out identically every time:
                        bugs reproduce, and engine/bot.harness.test.ts is a stable yardstick
                        rather than something that shifts between invocations.
                        Deliberately NOT world/terrain.ts's rng256 — that is the generator's
                        own LFSR, consumed in a fixed order to stay bit-identical to the
                        original game, re-seeded by every generateLevel() call (which the
                        menu and the level-code index make at arbitrary moments), and its
                        post-generation state is what produces the level codes. Drawing
                        gameplay values from it would make a run depend on whether someone
                        opened a menu. engine/particles.ts stays on Math.random: it is
                        cosmetic and driven by wall-clock frame timing, so it could never be
                        reproducible anyway.
    rules.ts            ENERGY_COST table and energyCostOf().
    turn.ts             TurnDriver — accumulator-based 4 Hz tick over rAF dt.
    timing.ts           TRANSFER_DELAY_MS = 1000, ACTION_COOLDOWN_MS = 1000,
                        WATCHER_GRACE_MS = 3000 (the lock-on stall — THE ONE NUMBER IN THE
                        DRAIN RULES THAT IS OURS: the original waits 5 s but also charged ~3 s
                        per transfer, so a nimbler player gets a shorter fuse. Settled by
                        playtesting). WON/LOST
                        have no timer for a human — WinScreen/LoseScreen dismiss on keypress
                        only. The demo-only timers live here too: DEMO_WIN_HOLD_MS = 4000 and
                        DEMO_LOSS_HOLD_MS = 3000 (App.svelte's supervisor — the end-screen
                        delay PLAN.md records as removed for human play, back for an audience
                        with nobody to press the key), plus the watchdog's
                        DEMO_NO_PROGRESS_MS = 30_000 and DEMO_LEVEL_LIMIT_MS = 300_000.
                        The two watchdog limbs catch different failures: no-progress catches
                        an idle bot, and the ceiling catches the *busy* one — 11 of the 102
                        sweep landscapes keep transferring and building without ever arriving,
                        so game.lastActionAt never stops moving and only elapsed time exposes
                        them.
    log.ts              Lightweight console.debug-based event logger.
    stats.test.ts       recordAbsorb/resetStats/load-save round-trip, plus the two-record
                        split: every recorder honouring setStatsTarget, the separate
                        localStorage keys, and a reset touching only the current record.
    state.test.ts       completeWon's 9999 cap + final-level skip, the once-per-run
                        gameCompletions guard, and the demo sandbox — a demo win advancing
                        only demoProgress/demoStats, the 9999 wrap back to 0, the cursor
                        holding on a loss, and resetDemoRun clearing it.
                        Plus describe('demo failure handling: strikes, blacklist and rewind'):
                        retry-in-place with a fresh levelEpoch each time, the third strike
                        blacklisting and rewinding to cameFrom, a win forgetting earlier failures,
                        the player's progress untouched throughout, and the three cases that hand
                        back to the menu (no cameFrom, the 9999 wrap leaving none, a blacklisted
                        rewind target).

  world/                               # Pure landscape + GameObject classes
    terrain.ts          Landscape generator — 1:1 port of Simon Owen's sentland Python.
                        BigInt 40-bit RNG, smoothing, despiking, object placement, codes.
                        Exports MAP_SIZE = 32 (fixed throughout the engine).
                        DO NOT touch casually: terrain.test.ts guards fingerprint parity.
    terrain.test.ts     Snapshot regression tests for levels 0 and 1 + structural checks
    objects/
      index.ts          Barrel re-export of all object classes
      base.ts           GameObject base class. remove() sets userData.skipRaycast the moment a
                        thing is absorbed: engine/scene.ts's objectsAt already treats it as gone, but
                        its MESH plays out a 1 s (squash) or 2 s (fade) animation, and until
                        2026-08-24 that corpse went on blocking engine/visibility.ts and resolving
                        under engine/picker.ts for the whole of it — one to two entire decisions at
                        the 1 Hz cadence, long enough for the bot to blacklist a cell the rules
                        considered clear, and for a human to click a thing that is not there. The
                        SPAWN animation is deliberately NOT treated this way: a materialising object
                        does exist to objectsAt and canPlaceAt, so it should block, and there the
                        rules and the raycasts already agree.
                        Owns spawn/absorb animations (playFade
                        drives the shader fadeMode/fadeProgress uniforms for both 'fade'
                        and 'dissolve' styles; playSquash animates scale.y for 'squash'),
                        animationScale multiplier, morphAnimationScale() — the speed each HALF of a
                        drain morph plays at, so the pair spans MORPH_DURATION_MS (game/timing.ts)
                        whatever the style: 2× squash, 4× fade/dissolve, 500 ms a half either way.
                        That makes a morph's duration a rules quantity rather than a consequence of a
                        display preference (A5b), where a flat 2× gave a 500 ms half under one style
                        and a 1000 ms one under the other. THE HALVES STAY SEQUENTIAL — squash away,
                        then inflate. Overlapping them into one cross-fade across the interval was
                        tried on 2026-08-25 and rejected on sight the next day: easeIn(t) = t² puts
                        the newcomer at a quarter height while the outgoing object is still at three
                        quarters, so it is hidden INSIDE the thing it replaces until the last third
                        and then swaps all at once. Don't re-try it. playSquash/playFade both clamp a
                        not-yet-started animation to its first frame, which is what lets a morph's
                        replacement be placed now and shown half an interval later — faceTowards
                        helper, and the userData = { gameObject, col, row } back-reference.
                        object3D is the merged Mesh returned by getObject (was: a Group
                        of per-face Meshes, pre-Phase-4.5).
      watcher.ts        Watcher base class — periodic turn animation gated on
                        game.firstActionTaken and drainLocked, cone-mesh visibility.
                        Sentinel and Sentry both extend this directly (siblings, not a
                        Sentry-extends-Sentinel chain) so `instanceof Watcher` reads as
                        the intended "either kind of watcher" check. Rotation period is
                        computed per-instance at construction from stats.svelte.ts's
                        gameCompletions — compounds 5% faster per completed game
                        (turnPeriodTicks = TURN_PERIOD_TICKS × 0.95^gameCompletions), a
                        replayability incentive. Meanie rotation (engine/meanie.ts) is
                        unaffected. Exposes the rotation clock read-only as ticksToTurn /
                        turnPeriod, which is what game/cone.ts predicts from — a window,
                        not a way to reach in and reset it. Plus `turning` (mode !== 'idle'),
                        because ticksToTurn and rot describe DIFFERENT MOMENTS while a turn is in
                        flight: playTick resets the countdown when the turn is queued, rot only
                        commits when the animation ends TURN_DURATION_MS later. game/exposure.ts
                        reads it to shift its schedule by one turn for that window; game/cone.ts
                        does not, and documents the resulting ~2-tick lag instead.
      watcher.test.ts   That clock, driven through real ticks: the turn lands exactly when
                        ticksToTurn said it would and then every turnPeriod, rot advances
                        by one ±20 step in the generator's direction, and a prediction of
                        "in sight in N ticks" comes true on tick N and not before. The half
                        game/cone.test.ts cannot reach, since it tests *where* a cone
                        points rather than *when* it moves.
      sentinel.ts       Sentinel — thin Watcher subclass, static type = SENTINEL.
      sentry.ts         Sentry — thin Watcher subclass, static type = SENTRY.
      synthoid.ts       Synthoid stub
      boulder.ts        Boulder stub
      tree.ts           Tree stub
      pedestal.ts       Pedestal stub
      meanie.ts         Meanie stub (behaviour lives in engine/meanie.ts, since it needs
                        scene access for LOS).
      models/
        index.ts        Model registry — getObject(type, options) returns a single Mesh
                        per object (merged BufferGeometry with per-vertex color +
                        fadeOffset attributes; one MeshPhongMaterial whose shader is
                        patched via onBeforeCompile to drive the fade animation through
                        the FadeUniforms exposed on material.userData.uniforms). Face/Model
                        interfaces and the FADE_MODE_* constants live here too.
        sentinel.ts     Raw vertex/face data
        sentry.ts       Raw vertex/face data
        synthoid.ts     Raw vertex/face data
        boulder.ts      Raw vertex/face data
        tree.ts         Raw vertex/face data
        pedestal.ts     Raw vertex/face data
        meanie.ts       Raw vertex/face data
```

`utils/` holds ESM Node scripts that are not part of the build:

- `obj-shrink.js` — one-off vertex deduplication for `.obj` exports.
- `terrain.js` — plain-JS copy of `world/terrain.ts`, so the analysis scripts can generate landscapes without a TS toolchain.
- `all-levels.js` — sweeps all 10000 landscapes to `utils/all.csv` (`node utils/all-levels.js > utils/all.csv`): sentry/tree counts, total absorbable energy, `heightGap` (Sentinel's tile minus the highest other flat tile, which sets the absorb pile at `2*gap+1` boulders) and `maxJump` (`totalEnergy - 8 - 4*gap`, the largest landscape jump the level can fund — an upper bound, it assumes everything is absorbable and the pile tile has LOS to the Sentinel).
- `paths.js` — routes landscape 0 → 9999 over that CSV (edges `i+1 .. i+maxJump`), writing `path-shortest.csv` (220 hops), `path-easiest.csv` (fewest hops never exceeding 5 secondary sentries — 4 is provably infeasible) and `path-fewest-sentries.csv` (least cumulative difficulty).
- `block-sweep.sh` — plays a block of landscapes with the demo bot in parallel: `BLOCK=6000-6999 PLANNER=v2 ./utils/block-sweep.sh out/label`. Shards the block across `CHUNKS` (default 12) concurrent vitest processes, one log each, then aggregates. 1000 landscapes in ~6 minutes against ~14 sequential. **Pair pre/post runs at identical block, `CHUNKS` and `FRAME_MS`** — blocks differ in difficulty, so only a delta on the same block at the same chunking means anything.
- `sweep-aggregate.js` — re-aggregates those chunk logs into one summary, byte-compatible with the harness's own. Deliberately **ignores each chunk's `sweep summary`** (averaging averages over unequal slices is wrong) and recomputes from the per-landscape lines; warns when the landscape count falls short of `--expect`, since a silently truncated run reads as a lower win rate. `--snapshot` writes a committed-artifact table in the same shape as `bot-v2-*.txt`.
- `bot-v2-6000-6999-preB4.txt` — the pre-B4 baseline for the verdict block, kept so the comparison stays reproducible. `bot-v2-3000-3999.txt` is the older diagnosis-set snapshot. `bot-v2-6000-6999-preRULES.txt` / `-postRULES.txt` bracket the rules-fidelity work; `-postAIM.txt` is the current standing, 888/1000.

`public/` holds only `favicon.png` — Vite copies it to `dist/` at build time.
