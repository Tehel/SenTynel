Human strategy

- is a sentry is absorbable, do it now (worst case if I'm watched, +2 energy)
- stay safe (no work under pressure): when watched, if a safe synthoid is available, transfer there, else identify a safe cell, spawn a synthoid and transfer.
- absorb anything you can, in descending energy value order (more energy is always good, and buys time in a dire situation)
- look for a safe higher cell that will give a view on an even higher one. If found, start ascending: put a boulder on a safe higher cell, put a synthoid on it, transfer to it, if the tower we're building gets absorbed, cancel that plan, absorb what's left on that cell, pick a new candidate cell and retry
- if there's no simple "small-steps" path for ascending, we need to plan a higher tower, either for the next step, of for the following one.
- harvest time: once we have reached the highest position and removed all the sentries, go harvest the remaining energy (trees, meanies, abandoned boulders or synthoids)
- finish: create the smallest possible tower that enables absorbing the sentinel, transfer there, absorb the last previous boulder+synthoid if any, absorb sentinel, spawn synthoid on pedestal, transfer to it, hyperspace

Notes:
- I'm still putting a high priority on fleeing, which you repeatedly rejected on the ground of testing. It may be more important for a human than for a bot, since bot efficiency is much better for actions, letting it staying stable as long as there are absorbable trees, whereas a human player will very soon lose. I'd still keep it high, as time spent "surviving" is probably time lost.
- When looking for "safe" cell (either to ascend or flee), human is at a big disadvantage: partial knowledge of the cones (invisible, but often estimable) and it's often trial-and-error thing: spawn a boulder, see if it holds, if not absorb the remaining tree and try somewhere else. I also do try to remember the way the watchers rotate to estimate the future state, but I do not always have the information, especially early in the game. Bot will know all and predict perfectly, I expect a huge efficiency gain here.
- Optimisations:
  - when choosing a cell to build a tower, especially around the sentinel, I try to put it in a place where it become watched in the latest (typically, waiting for the sentinel to rotate and choosing a place that it just stopped watching).
  - when in the "harvesting" phase, I often deliberately leave a synthoid in a very high place (the "winning" one, possibly at sentinel level, ready to finish) and "branch" from it to go gather the latest trees, spawing single-use simple synthoids (no boulders) in places that can get trees, transfer to them, absorb the trees, transfer back to the "winning" one and absorb the temporary synthoid back.
  - sometimes not moving is the right choice. It there's a very promising cell that is currently watched and we're in a safe position, we can wait for the target cell to become safe.
