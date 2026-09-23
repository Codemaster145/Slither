# Luma Coil

An original, guest-only multiplayer snake arena. A TypeScript/Canvas frontend connects to one authoritative Node.js/Socket.IO server. Humans on separate computers share positions, pellets, collisions, deaths, scores, and rooms through actual persistent network connections. **There are no gameplay bots or simulated players.** The decorative coil on the menu is an illustration.

Features include 32-player public arenas with automatic overflow, six-digit private rooms and invite links, six original skins, continuous movement, mass-consuming boost, body collisions, death food, instant respawn, a live leaderboard, minimap, mobile steering/boost, and original synthesized sound/music with volume and mute controls. Fonts ship locally with the app.

## Run locally

Requires Node.js 22.12+ and npm. From this repository:

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/socket.io` to the server on port 3001. Both listen on `0.0.0.0`, so a second device on your network can open `http://YOUR_COMPUTER_LAN_IP:5173`. Permit these ports through your local firewall when necessary. Do not use `localhost` on the second device: that addresses the second device itself.

Production build, served by one process:

```sh
npm run build
npm start
```

Open **http://localhost:3001**. The Node process serves both `dist/client` and Socket.IO; no Vite server is needed. `/health` returns service health and current room/player counts.

## Play

Point your mouse to steer; you always move forward. Collect food to increase mass and length. Bright large pellets are worth four mass; ordinary pellets are worth one; remains carry varying mass. Hold Space or the left mouse button to boost after growing beyond 36 mass. Boost costs seven mass per second and leaves edible sparks.

Touch another coil's body, including its head, and you die. Head-on collisions kill both players. Your own body is safe. The visible circular arena boundary is lethal, with a warning near the edge. New coils have 2.5 seconds of mutual body-collision protection, shown by a dotted halo. The boundary remains lethal during protection. Press “One more round” to respawn without leaving the room.

On a touch screen, drag relative to the screen center to steer, and hold the dedicated BOOST button. Desktop is the primary input method.

## Private rooms and two-computer test

1. On computer A, open the app, enter `PlayerOne`, and choose **Create Private Room**.
2. Read the six-digit code in the upper-left HUD. The copy icon copies an invite URL containing `?room=123456`. If clipboard access is unavailable, a selectable link is displayed.
3. On computer B, open the **same server's URL**, enter `PlayerTwo`, choose **Join Private Room**, and enter A's code. Or open A's invite link.
4. Both players spawn in the same region. Steer and verify each sees the other move. Collect a pellet, check both leaderboards, and test collision/respawn.
5. Close B's tab; A's player count drops. Reopen and rejoin with the same code.

For two different internet connections, use the public HTTPS URL deployed below. A LAN IP or `localhost` is not publicly reachable. No account is required to play. Duplicate names receive a numeric suffix. Private rooms are isolated arenas; possession of the code grants entry (they are not authenticated or encrypted separately from HTTPS).

Empty rooms expire after 60 seconds. State lives in memory. Server restarts/deployments clear rooms and runs. A temporary transport interruption reconnects the guest to the previous room with a **new coil and reset mass**. An expired room returns a clear error so the player can create another. Disconnects remove the old coil immediately after transport loss is detected (heartbeat detection can take up to 15 seconds).

## Architecture and important files

| File                        | Responsibility                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `server/index.ts`           | HTTP server, validated Socket.IO events, rooms, rate budgets, fixed simulation loop and snapshots                 |
| `server/arena.ts`           | Authoritative movement, history trails, mass, food, collisions, deaths, spawn protection and visible-state deltas |
| `server/spatial.ts`         | Spatial hash for food and nearby body collision queries                                                           |
| `shared/protocol.ts`        | Typed messages, tuning constants, skin palette and world dimensions                                               |
| `client/src/main.ts`        | Connection lifecycle, menu/HUD actions, input and audio integration                                               |
| `client/src/renderer.ts`    | Canvas rendering, interpolation, camera, minimap, particles and menu artwork                                      |
| `client/src/markup.ts`      | Main menu, dialogs and HUD structure                                                                              |
| `client/src/audio.ts`       | Original oscillator-based sound effects and ambient music                                                         |
| `client/src/style.css`      | Responsive visual design                                                                                          |
| `tests/`                    | Simulation, real socket integration, 32-client load and two-browser acceptance tests                              |
| `render.yaml`, `Dockerfile` | Public deployment configurations                                                                                  |

### Networking and performance

The server simulates at **30 Hz** and publishes snapshots at **15 Hz**. Clients send only desired angle and boolean boost at 30 Hz. Server-side turn limits, fixed speeds and mass budgets determine the result. Inputs over 45/second are ignored; room actions are limited to five/second per socket. Names are normalized, stripped of markup/control characters, capped to 20 characters, and rendered with `textContent`. Invalid packet shapes, non-finite angles, invalid skins and unknown rooms are rejected. Transport messages are capped at 2 KiB.

Each arena has a 2,600-unit radius, 2,400 ambient food particles, a 32-player capacity, capped growth, and a cap on extra dropped food. Food and body checks use spatial hashes instead of every player checking every food or every other body. Bodies are compact movement trails, not physics objects. Food has stable per-room IDs; players use their connection IDs.

Only entities within a 1,650-unit relevance radius are transmitted. Food is sent on entering that radius, then as additions/removals; it is not retransmitted every tick. Nearby snake trails are quantized, sampled about every 15 units, and published with their head state. Leaderboards contain ten entries. Snapshots use reliable delivery because food deltas cannot be dropped; congested transports are skipped before changing their known-food set. Client rendering additionally culls offscreen food and constrains the camera so the viewport fits the relevance radius.

The renderer buffers 100 ms for interpolated motion, including bodies, and extrapolates for at most 50 ms when a snapshot is late. Camera motion and zoom ease smoothly. Swept server head checks prevent tunneling; a slightly forgiving body collision radius and spawn shield reduce unfair-looking impacts. **There is no historical server rewind or full client movement prediction**: high latency will still delay steering, and this needs further tuning under real WAN conditions.

Use **one server process/instance**. Raising the room player limit is a tuning change, but multi-instance scaling requires an explicit room-owner/routing design. Merely enabling a Socket.IO Redis adapter does not distribute the in-memory simulation. There is no persistent account database.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run typecheck
npm run format:check
```

`npm test` exercises motion/boost authority, shared food deltas, body/head/boundary deaths, respawn, name handling, room isolation/capacity, malformed inputs, real WebSocket disconnect cleanup, and 32 simultaneous real socket clients. The load test prints observed snapshot frequency and traffic on the machine running it; it is not an internet throughput guarantee.

`npm run test:browser` builds production assets, starts an isolated real server and opens two independent Chromium browser contexts. It verifies both players' received movement snapshots, shared food removal, scores/leaderboards, boost, body collision/death, respawn, transport reconnection, disconnect cleanup, invite links, invalid rooms, skins, settings and a mobile-width layout. Test fixtures can position entities directly in the in-process test server to make collisions reproducible; **no test-control endpoints or client score/position controls exist in production**. Screenshots are written to `test-results/`.

These tests were executed locally. An actual cross-internet test must be performed after deployment with two independent devices/connections; local browser contexts do not establish that a hosting account, DNS, firewall and TLS configuration work.

## Environment

| Variable          | Where          | Default / purpose                                                                                     |
| ----------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `PORT`            | Server runtime | `3001`; most hosts inject this automatically                                                          |
| `ALLOWED_ORIGINS` | Server runtime | Unset permits the request's same origin; set comma-separated exact frontend origins for split hosting |
| `VITE_SERVER_URL` | Frontend build | Unset connects to the page origin; set to the public HTTPS backend origin only for split hosting      |
| `NODE_ENV`        | Server runtime | Set `production` on your host                                                                         |

`.env.example` documents these values. The backend reads actual process environment variables; it does not automatically load `.env`. Set them in your host dashboard or shell, or use Node's `--env-file` option for the built server. Vite reads frontend `.env` files from `client/`, or exported environment variables at build time. For example:

```sh
VITE_SERVER_URL=https://your-backend.example npm run build
ALLOWED_ORIGINS=https://your-frontend.example npm start
```

Keep `VITE_SERVER_URL` unset for the recommended single-service deployment. Do not put localhost into a production build. No secrets belong in a `VITE_` variable.

## Deploy publicly on Render (recommended)

Render Web Services support persistent WebSockets and serve public HTTPS traffic. See the official [Node deployment instructions](https://render.com/docs/deploy-node-express-app) and [WebSocket documentation](https://render.com/docs/websocket). This repository is prepared for deployment; it has **not been published to a hosting account**.

1. Push this repository to a GitHub/GitLab repository you control, including `package-lock.json`.
2. In Render, choose **New → Web Service**, then connect that repository. Use the repository root.
3. Select the **Node** runtime. Set the build command to `npm ci --include=dev && npm run build` and the start command to `npm start`.
4. Set `NODE_VERSION=22` and `NODE_ENV=production`. Leave `PORT` host-managed. Leave `VITE_SERVER_URL` and `ALLOWED_ORIGINS` unset for same-origin hosting.
5. Choose an always-on instance and keep **exactly one instance**. `render.yaml` supplies a Starter single-instance configuration if you prefer Render's Blueprint import; review the hosting charge before creating it.
6. Set the health check path to `/health`, then deploy. Wait for the health check and build to pass.
7. Open the assigned `https://YOUR-SERVICE.onrender.com` URL. The menu must say SERVER ONLINE, and `/health` must report `ok: true`.
8. Perform the two-computer test above using this HTTPS URL, with the second computer on a different internet connection. Verify private codes, live movement, food, collision, respawn and reconnection.

Frontend and backend share this single URL and port. Socket.IO automatically uses secure WebSockets on HTTPS. No separate static site is needed. A deploy replaces the server and ends existing runs; guests reconnect, but private rooms must be recreated after a restart. Free sleeping instances can add cold-start delays, so an always-on host is preferable for a game.

### Docker / another persistent host

```sh
docker build -t luma-coil .
docker run --rm -p 3001:3001 -e PORT=3001 luma-coil
```

Deploy this container to a persistent Node/container web service with one instance, port 3001 (or injected `PORT`), and HTTPS termination. The included container runs as a non-root user. If using your own reverse proxy, preserve `Host`, set `X-Forwarded-Proto`, forward WebSocket `Upgrade`/`Connection` headers and allow long-lived connections on `/socket.io/`. Health check: `/health`.

### Optional separate frontend and backend

Build with `VITE_SERVER_URL=https://YOUR-BACKEND` and upload **`dist/client`** to a static host. Run the backend on a persistent WebSocket-capable host with `ALLOWED_ORIGINS=https://YOUR-FRONTEND` (exact origin, no trailing slash). Rebuild the frontend whenever its backend URL changes. Both origins need HTTPS. The backend must remain a long-running process; a static deployment alone cannot host multiplayer. Configure any custom reverse proxy to support Socket.IO polling and WebSocket upgrades.

## Troubleshooting and limits

- **SERVER OFFLINE:** check the server logs and `/health`. In development ensure ports 5173 and 3001 are available. On another device use the host's LAN IP or deployed URL.
- **Works locally, fails publicly:** check the browser Network panel for `/socket.io/` and a WebSocket 101 upgrade. Check build-time `VITE_SERVER_URL`, exact allowed origins, HTTPS, proxy upgrade headers and whether the host supports persistent connections.
- **Room not found:** confirm both clients use the same backend instance and code. Empty rooms expire after a minute, and restarts clear all rooms.
- **Room full:** private rooms stop at 32 guests. Quick Play creates another public arena automatically.
- **Quiet public arena:** this build deliberately has no bots. Invite another human; the online count represents actual connections.
- **Lag:** use a hosting region close to your players. Input prediction, adaptive jitter buffering and WAN latency tuning remain future improvements. A 32-client local test is not a large production load test.
- **Scaling/abuse:** current packet/rate validation is basic protection. Before promoting a large public launch, add edge connection throttling, operational metrics, stress testing, and a room-routing plan. Current state is ephemeral, with at most 100 rooms per process.
- **Music is silent:** browsers require a user gesture before audio. Start a match or open settings, then check mute and volume sliders.

All game art is programmatic and original; sound is synthesized at runtime. DM Sans and Space Grotesk are bundled via Fontsource under their included open font licenses. No third-party game code or assets are used.
