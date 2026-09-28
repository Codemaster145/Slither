# Luma Coil

An original glowing snake arena, now a **self-contained browser game for ChatGPT Sites**. The default experience is single-player versus AI. Visitors need no game account; their name is optional. The Site makes no Socket.IO, Render, or external game-server requests. Fonts, graphics, sounds, physics, AI and rendering run locally in the browser.

The original online multiplayer implementation is preserved separately. See [multiplayer documentation](docs/multiplayer.md).

## Play locally

Node.js 22.12+ and npm are needed to develop/build, not to play the published static Site.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

```sh
npm run build
npm start
```

This builds static files into `dist/client` and previews them at the URL Vite prints (normally http://localhost:4173). `.openai/hosting.json` declares that static directory for ChatGPT Sites. No server environment variables are needed. The Site starts at its main menu, with no in-game sign-in. Public deployment is intentionally pending the user's preview review; registration alone does not make a live Site.

## Controls and modes

- Mouse: point to steer, hold Space or left click to boost. Touch: drag to steer and hold the dedicated Boost button.
- Collect glowing pellets to grow; boost spends mass. Your own tail is safe. Another coil's body or the circular boundary ends your run. New coils have a 2.5-second body shield; the boundary is always lethal.
- Esc or the pause button pauses the entire arena. Switching tabs also pauses it; resume explicitly when returning.
- **Quick Play:** Normal difficulty, 20 AI.
- **Custom Game:** Easy, Normal, Hard, Expert or Mixed; choose 10, 20 or 30 AI. Choose any of six original skins.
- Death reports score, rank, survival time, pellets eaten, peak mass and difficulty. Respawn preserves the arena and AI population without reloading. Returning to the menu terminates its worker.
- Best score, best rank, longest survival and runs played are stored per browser tab/session. Every new life counts as a run. No cloud account or persistence is required.

## Difficulty and fairness

| Tier   | Reaction interval (with jitter) | Local vision | Decisions                                                                                |
| ------ | ------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| Easy   | ~480 ms                         | 280 units    | Short planning, inaccurate turns, frequent mistakes, rare boosts                         |
| Normal | ~260 ms                         | 410 units    | Food value/distance targeting, nearby avoidance, occasional boosts                       |
| Hard   | ~170 ms                         | 550 units    | Predicted nearby head movement, safe cutoff attempts, strategic boosts                   |
| Expert | ~115 ms                         | 690 units    | Longer size-aware planning, predicted threats, escape-exit checks, offense/escape boosts |

All tiers use the same speed, turn rate, boost cost, food pickup, growth, shielding and collision implementation as the player. AI produces ordinary steering/boost inputs. It does not modify position or mass directly. Body and food searches are spatially bounded; head prediction excludes heads outside vision. All tiers have aiming noise and imperfect reactions.

Aggressive, cautious, food-hunter and balanced personalities vary food interest, spacing, aggression and boost probability. Mixed repeats a ten-coil distribution: two Easy, five Normal, two Hard and one Expert. Names come from the original 60-name pool, shuffled without replacement. Dead AI drops food and respawns after 2–3.8 seconds; the living count may temporarily be below the selected population.

## Architecture

| Files                                                    | Responsibility                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `shared/arena.ts`, `shared/spatial.ts`                   | Platform-neutral authoritative rules and spatial hashes, shared with multiplayer |
| `shared/local-game.ts`, `shared/names.ts`                | Local AI decisions, personalities, population and respawn lifecycle              |
| `shared/worker-protocol.ts`, `client/src/game-worker.ts` | Typed messages, fixed 30 Hz physics, 15 Hz snapshots, staggered AI thinking      |
| `client/src/main.ts`, `markup.ts`, `site.css`            | Default Site menu, input, difficulty controls, HUD, pause/death/session flows    |
| `client/src/renderer.ts`, `audio.ts`, `style.css`        | Original smooth Canvas renderer, effects, minimap, sound and visual identity     |
| `client/src/multiplayer.ts`, `multiplayer-markup.ts`     | Preserved network client, isolated from the Site import graph                    |
| `server/`                                                | Preserved authoritative Socket.IO server, private rooms and public bots          |
| `vite.config.ts`, `vite.multiplayer.config.ts`           | Separate static Site and multiplayer builds                                      |

Physics and AI run in a dedicated Web Worker; the main thread renders via requestAnimationFrame, normally at the display refresh rate. Nearby spatial queries avoid full-map food/body scans. A read-only `read_arena_status` WebMCP tool is feature-detected for supporting browsers and uses the same state as the HUD.

## Verification

```sh
npm test
npm run build
npm run build:multiplayer
npx playwright test
npm run format:check
```

The suite covers shared movement/collision rules, all 15 difficulty/count combinations, bounded AI perception, equal human/AI speeds and costs, food/growth, death drops, respawning, three-minute 30-AI simulations, real multiplayer clients, offline browser play, pause, settings, session stats, restarts, touch UI and browser frame timing.

On this development Mac, a seeded three-minute simulation with 30 AI recorded 228 Easy deaths, 169 Normal deaths, 9 Hard deaths and 6 Expert deaths. This is a regression scenario, not a universal difficulty ranking. Expert physics/AI plus snapshot work measured about 2.5 ms at p95 in the isolated run. Chrome's 30-Expert rendering sample measured a ~16.7 ms median frame (about 60 FPS); hardware, browsers and very long sessions can differ. Mobile was exercised using touch emulation, not physical devices.

Playwright automatically uses installed Chrome on this Mac; other systems use its bundled Chromium (`npx playwright install chromium`). The test environment occasionally jumps its monotonic clock while suspended; `npx playwright test --timeout=0` avoids false overall timeout failures during such sessions. Assertions remain independently bounded except the actual boundary-death wait.

## Preserved multiplayer

```sh
npm run dev:multiplayer
# Open http://localhost:5173/multiplayer.html
npm run build:multiplayer
npm run start:multiplayer
# Production multiplayer: http://localhost:3001
```

Private rooms, shared real-player arenas and adaptive server bots are unchanged in purpose. Dockerfile/render.yaml explicitly build and run this multiplayer variant. Render is optional for that separate variant and is not used by the Site. Separate browser clients and the 32-client networking regression remain in the test suite.

## Remaining scope

No optional Survival mode was added. Desktop and touch-emulated flows are covered; testing physical phones and longer play sessions would improve tuning. Expert AI uses bounded local heuristics, not perfect global planning. Online multiplayer remains a separate server-hosted experience.

Artwork and sounds are original and procedural. DM Sans and Space Grotesk are bundled through Fontsource under their included open font licenses.
