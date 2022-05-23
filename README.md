# SenTynel

A Typescript + Svelte + ThreeJs reimplementation of Geoff Crammond's [The
Sentinel](<https://en.wikipedia.org/wiki/The_Sentinel_(video_game)>) classic game.

![preview of level 0](preview.png 'Level 0')

## Why

This is a purely educational project, to play with 3D tools, while experimenting with terrain generation algorithmns and paying some hommage to video game history.

This project, both in its idea and implementation, owes a lot to [Simon Owen](https://github.com/simonowen), who produced Augmentinel, a modernized-yet-faithful adaptation of the game, using C++, Direct3D and an embedded Spectrum emulator running the actual game. The terrain generation is almost completely taken from [his Python port](https://github.com/simonowen/sentland) of it, which got me started.

## Get it to run

Checkout the project:

```
git clone https://github.com/Tehel/sentynel.git
cd sentynel
```

Start serving the site:

```
npx http-server
```

Then open http://localhost:8080/ in a browser.

If you don't have Node.js/npm installed, you can use any other basic web server to serve the "public" directory instead.

## Rebuild the project

To run in dev mode or simply rebuild the project, you'll need to have Node.js already installed and install the dependencies:

```
npm ci
```

Run in dev mode (with dynamic reloads when you update the source):

```
npm run dev
```

Build a production version:

```
npm run build
```

## How to use it

You should see a rotating view of level 0000. "Settings" checkbox shows some terrain generation settings, the default values being the ones from the original game.

Clicking in the view will give you control of the camera, to be moved with "W/A/S/D" (+shift to double speed). FOV can be changed with "\[" and "\]". "R" releases control and switches back to the rotating view.
