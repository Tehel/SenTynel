# SenTynel

A Typescript + Svelte + ThreeJs reimplementation of Geoff Crammond's [The
Sentinel](<https://en.wikipedia.org/wiki/The_Sentinel_(video_game)>) classic game.

## Why

This is a purely educational project, to play with 3D tools, while experimenting with terrain generation algorithmns and paying some hommage to video game history.

This project, both in its idea and implementation, owes a lot to [Simon Owen](https://github.com/simonowen), who produced a modernized-yet-faithful adaptation of the game, using C++, Direct3D and an embedded Spectrum emulator running the actual game. The terrain generation is almost completely taken from [his Python port](https://github.com/simonowen/sentland) of it, which got me started.

## Get it to run

git clone https://github.com/Tehel/dmjs/sentynel.git

```
npm ci
```

Run in dev mode:

```
npm run dev
```

or alternatively, build a static site and serve it:

```
npm run build
npx http-server
```

Then open http://localhost:8080/ in a browser.

## How to use it

You should have a rotating view of level 0000. "Settings" checkbox shows some terrain generation settings, the default values being the ones from the original game.

Clicking in the view will give you control of the camera, to be moved with "W/A/S/D", and "Q" and "E" for up/down. FOV can be changed with "\[" and "\]". "R" releases control and switches back to the rotating view.
