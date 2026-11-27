# BlowUp

![BlowUp game logo](public/ui/title-logo.webp)

**A real-time hot potato party game on Solana.** Six players, one bomb, and a fuse that changes with every pass. Chase, dodge, tag or throw, and be the last player standing.

Built for [MagicBlock Solana Blitz V10](https://build.magicblock.app/?event=17&stage=blitz). Online matches run on a **MagicBlock Ephemeral Rollup**, **MagicBlock VRF** determines who gets the bomb and how long the fuse burns, and completed matches leave a verifiable result on **Solana devnet**.

[Deployed program](https://explorer.solana.com/address/915f4aBTkrJaZ4ym6D85AoNLHQwazUC3vmbjgQNyhyob?cluster=devnet) · [Verified private-room result](https://explorer.solana.com/address/6pvJg3QZsoQSjo1dsaUFYcZpoMYohRTssxx1hSHDZuRm?cluster=devnet) · [Verified quick-play result](https://explorer.solana.com/address/7bJgXkxHRJfQKVuywZFredRg4doxCmjoMCrJPrAzoZAc?cluster=devnet)

## Play the demo

1. Open the game in a desktop browser, enter a name, pick a character, and choose **Online**. Guests can play without a wallet or SOL. Quick play fills empty seats with bots after an eight-second matchmaking window and picks one of four harbour arenas on a clear morning.
2. **WASD** to move, **Space** to dash, **left-click** to throw, and **right-click** to tag. Pass before the fuse runs out. Each elimination starts another round until one player remains.
3. Open **Match details** after the game and follow **View match on Solana**. The results screen can appear while the rollup is still settling.

To play with friends, choose **Private**, create a room and share its invite link. Everyone readies up before the host starts. With bot fill off, the room accepts two to six players. Use separate devices or browser profiles for distinct guest identities. **Bots** and the tutorial are playable locally.

**Optional wallet progress.** Sign a single link message in the menu to track online matches, wins, podiums, passes and bombs received. The wallet link survives reloads on the same site until the 24-hour proof expires. Gameplay still uses a match session key.

## What MagicBlock powers

| Layer | What it does in BlowUp |
| --- | --- |
| **Solana devnet** | The lobby sponsors account creation and delegates the match and player PDAs. After the game, Solana stores the match result and credits linked wallet profiles. |
| **MagicBlock Ephemeral Rollup** | Clients and bots send position updates at up to 10 Hz. The program validates session authorization, input sequencing and movement, then enforces bomb ownership, transfer range, protection, fuse deadlines and eliminations. The browser predicts local movement and mirrors rollup state for presentation. |
| **MagicBlock VRF** | Selects the opening holder and fuse in each round and a fresh fuse after every successful pass. The callback is bound to the current request nonce. The game shows the fuse arming while it waits, and the lobby retries stalled requests. |
| **Commit and undelegate** | After the last elimination, the lobby commits the final rollup state back to Solana. It then records the winner and placements in a `MatchResult` PDA. Linked players receive one profile credit per eligible seat per match. |

Free guest access and a shared, unpredictable bomb timer are part of the same match flow. Players send scoped session transactions during play, and spectators can inspect the result without trusting a scoreboard maintained by the lobby.

## Devnet evidence

| Run | Result |
| --- | --- |
| Three-browser private room | Three humans, bot fill off, two elimination rounds and the same result in all three browsers. Both opening VRF draws reproduced, the result settled, and a linked test wallet received exactly one credit. [Solana result](https://explorer.solana.com/address/6pvJg3QZsoQSjo1dsaUFYcZpoMYohRTssxx1hSHDZuRm?cluster=devnet) |
| Scripted quick play | Eight checks passed across matchmaking, bot takeover, reconnect, rejoin and settlement. Three scripted humans and three bots completed the match with 14 transfers. [Solana result](https://explorer.solana.com/address/7bJgXkxHRJfQKVuywZFredRg4doxCmjoMCrJPrAzoZAc?cluster=devnet) |

To independently recompute the private room's opening holders and fuses from public callback history, install the root and chain dependencies first. The verifier only reads public data.

```bash
npm ci
npm ci --prefix chain
npx tsx chain/verify-draws.ts 42gzkLfEQjCeVMp41KJSJxRCyB5kRM4vzT3DvdAmbCB2 https://devnet-as.magicblock.app/
```

**Current limits.** The private-room browser run verified the full lifecycle. Under headless software rendering, one browser missed its first input window and a takeover bot made the recorded pass. A three-device human playtest is still needed. Online passes have on-chain range checks. Obstacle and projectile enforcement, weather physics, and pickups and abilities are offline gameplay features. The earlier feasibility run measured input visibility at **108 ms p50 / 163 ms p95**, above the **100 ms p95** target. [Submission verification](docs/submission-check.md) · [Feasibility measurements](docs/phase-00-findings.md)

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:5173` for offline play. For online play, run `npm run server` in a second terminal with a funded Solana devnet lobby signer. Set `AUTHORITY_KEY` to the key file path, or use the gitignored default `.keys/authority.json`. Vite proxies `/api` to port `8787`.

For a hosted demo, run `npm run build` before `npm run server`. The lobby serves the production build and API from the same port, which can sit behind a tunnel. It defaults to three active matches shared by quick play and private rooms. Public matches spend the lobby's devnet SOL. Keep signer files outside the public build. See the [development handoff](docs/HANDOFF.md) for the Anchor toolchain, IDL and operational details.

```bash
npm test
npm run typecheck
cargo test -p blowup --lib
```

## Code map

| Path | Responsibility |
| --- | --- |
| [`programs/blowup/`](programs/blowup/) | Anchor instructions, account validation, VRF callbacks, match rules and settlement |
| [`server/`](server/) | Sponsored matchmaking, private rooms, rollup readiness, bots, takeover and settlement |
| [`src/chain/`](src/chain/) | Browser rollup session, prediction and reconciliation, wallet link and profile reads |
| [`src/game/`](src/game/) · [`src/render/`](src/render/) | Offline simulation and bots, arena layouts, and the React Three Fiber scene |
| [`chain/`](chain/) | IDL, feasibility harness, VRF verification and raw reports |

## Credits

Characters and animations by [KayKit](https://kaylousberg.itch.io). Harbour models from [Kenney](https://kenney.nl) and [Quaternius](https://quaternius.com), with [model credits](public/models/CREDITS.md). Sound effects and jingles from [Kenney](public/audio/CREDITS.md). The painted UI uses CraftPix assets under their [separate terms](public/ui/LICENSE.txt). Fonts are Alfa Slab One and Signika. The BlowUp logo was made for the game.
