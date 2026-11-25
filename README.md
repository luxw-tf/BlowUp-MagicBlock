# BlowUp (working title)

Browser party game from `BlowUp-PRD-v0.1.docx`: six creatures, one bomb, a randomized public fuse. This build covers **PRD Phase 01 (playable foundation)**, most of **Phase 02 (gameplay depth)** offline, **Phase 00 (MagicBlock feasibility)**, and **Phase 03 milestone 1: playing online against on-chain bots**.

```bash
npm install
npm run dev        # http://localhost:5173  (add ?quick to skip menus)
npm run server     # lobby service for "Play online" (needs .keys/authority.json with devnet SOL)
npm test           # simulation unit tests + full bot-match runs
npm run build
```

Controls: WASD move · mouse aim · LMB throw · RMB tag · Space dash · E item · Esc settings.

## Architecture

```
src/game/          authoritative, renderer-free (destined for the MagicBlock ER program)
  config.ts        every tuning value from the PRD (all provisional)
  arena.ts         The Docks: 36×20 bounds, basin, crates, spawns, pickup spots, collision
  sim.ts           fixed 20 Hz tick: movement, dash, tag/throw, fuse, abilities, eliminations
  randomness.ts    RandomnessProvider interface + LocalDevRandomness (labelled unverified)
  bots.ts          bot brains — read public state, emit the same InputFrame as humans
  session.ts       local "transport": fixed-step loop, input gathering, randomness dispatch/retry
src/render/        React Three Fiber scene (arena, creatures, bomb, pickups, VFX, camera)
src/ui/            landing/onboarding, lobby, HUD, results, settings, match-details panel
src/audio/         synthesized WebAudio placeholders
```

Key rules implemented as specified:

- The sim **never generates randomness**. Holder draws, fuse lengths and pickup rewards are explicit `randomRequests`. The match visibly waits ("drawing bomb holder…", fuse "…", item spinner) until `fulfillRandomness()` is called. Stale or duplicate fulfilments are ignored, and unanswered requests are retried after a bounded wait.
- Expiration is checked before any action each tick. A fuse that expires mid-flight eliminates the thrower. The 45s hard round deadline caps every fuse, including Time Theft.
- Inputs carry sequence numbers. Stale or duplicate frames are rejected, and move vectors are clamped.
- Transfer protection (0.35s) blocks tag-backs. Return to Sender ignores it, since it is an explicit reflection.

## Phase 00 — MagicBlock feasibility (validated on devnet)

Deployed to **devnet**: program `915f4aBTkrJaZ4ym6D85AoNLHQwazUC3vmbjgQNyhyob` (IDL committed at `chain/idl/blowup.json`).

**Result: works end to end; one PRD target missed.** A full six-player match runs on the ER with VRF draws, validated inputs and idempotent settlement on Solana. Unfunded guest keys can play. Input latency is ~110–150 ms to other players (p50), above the <100 ms p95 target. Full numbers, pitfalls and Phase 03 implications: **[docs/phase-00-findings.md](docs/phase-00-findings.md)**.

```
programs/blowup/       Anchor 1.0.2 program, ephemeral-rollups-sdk =0.18.0 (anchor + vrf features)
  src/rules.rs         pure fuse/holder/movement rules (cargo unit tests)
  src/state.rs         MatchState, PlayerState, MatchResult accounts
  src/lib.rs           create/join/delegate (base) → start/input/transfer/eliminate/finalize (ER) → record_result (base)
chain/feasibility.ts   devnet harness: runs a full match and writes chain/reports/feasibility-*.json
chain/verify-draws.ts  recomputes every holder pick / fuse of a match from its raw VRF callbacks
chain/diagnose.ts      ER transaction logs + clock skew for a match account
docs/phase-00-findings.md
```

Design notes:
- Guests get two keys and no wallet: an identity key and a match-scoped session key with an on-chain expiry. The lobby authority sponsors rent and delegation.
- Holder and fuse draws use VRF on the ephemeral queue. Each callback is bound to a nonce, so stale or duplicate fulfilments are ignored, and `retry_randomness` re-requests after 3s. Draws are `sha256("blowup" ‖ tag ‖ randomness)`, so anyone can recompute them.
- Deadlines are in ER slots (~10 ms each on devnet), converted with the match's `slot_ms`. Session expiry uses the ER clock, which runs ~51 s behind wall time.
- Not yet enforced on-chain: throw line-of-sight and obstacles (range only), pickups and abilities.

Build/run (needs WSL Ubuntu with Rust 1.89, Solana 3.1.9, Anchor 1.0.2, platform-tools v1.52):
```bash
cargo test -p blowup --lib && anchor build
solana program deploy target/deploy/blowup.so --program-id target/deploy/blowup-keypair.json \
  --buffer .keys/deploy-buffer.json -k .keys/authority.json --url devnet   # re-run to resume
cd chain && npm install && npm run feasibility    # then: npx tsx verify-draws.ts reports/<latest>.json
```
Keys (`.keys/authority.json` = upgrade authority, `.keys/blowup-program.json` = program keypair backup) are gitignored. Don't lose them, or the program can't be upgraded.

## Phase 03 — online play

**Play online (devnet)** and **Private room** on the landing page run real matches on a MagicBlock Ephemeral Rollup. No wallet and no SOL are needed:

```
server/                  lobby service (local Node): matchmaking, sponsored setup, bots, takeover, crank, settlement
  index.ts               HTTP API (queue, tickets, rooms, matches; Vite proxies /api in dev)
  lobby.ts               quick-play queue + private rooms
  match-runner.ts        one match end to end; bots = BotBrain over a ChainMirror, acting via transactions
  test-multiplayer.ts    scripted multi-client test (real OnlineSessions, no rendering)
src/chain/
  program.ts             shared program client: PDAs, decoding, instruction builders, watchAccount, SlotClock
  mirror.ts              on-chain accounts → the client's MatchState + derived game events
  online-session.ts      browser session: predicted own movement, mirrored others, tag/throw → transfer, reclaim
src/ui/                  OnlineLobby (queue), RoomScreen (private rooms), onlineFlow (API + rejoin)
```

**Matchmaking (milestone 2).** Quick play groups humans first. When 6 are waiting, or the oldest has waited 8 s (`QUEUE_WINDOW_MS`), the match starts and bots fill the empty seats. Private rooms have a 5-letter code and an invite link (`?room=CODE`), per-player ready states, and host-controlled bot fill. Without bots a room needs 2–6 humans. Names are made unique per match.

**Disconnects (milestone 2).** If a player sends no input for 6 s (15 s for a first input after the match goes live), the lobby calls the on-chain `takeover`, which only succeeds after 5 s of silence, and a bot plays the seat. When the player is active again, their client automatically re-keys the seat with `renew_session`, signed by the guest identity, and the bot steps aside. After a reload, the landing page offers **Rejoin your match**.

How a match flows:
1. The lobby creates and joins the match for each guest's identity and session keys, plus bot keys for any filled seats.
2. It delegates the accounts to the closest ER and starts the match, which draws the holder by VRF.
3. Clients and bots stream absolute positions at 10 Hz. Passes are `transfer` transactions, range-checked on-chain.
4. The lobby cranks each elimination as soon as the fuse slot passes (~0.2 s measured).
5. The lobby finalizes (commit + undelegate) and records `MatchResult` on Solana. The match-details panel links it.

Verified on devnet in a headless browser:
- lobby → live match → 5 VRF rounds → results → settled
- server-only matches with 15–19 bot transfers

Known gaps:
- No pickups/abilities online (offline only for now).
- Other players' throws aren't animated; you see the pass land.
- The lobby API is polled (0.4–1 s). Fine for local dev; a websocket channel would cut lobby latency.
- On-chain, a player who never sent an input can be taken over immediately. The lobby applies the 15 s first-input grace.
- Bots run on the lobby, so the lobby must stay up for a match to finish. If it dies mid-match, `abort_match` and the 8-minute timeout are the only recovery.
- The lobby holds the devnet authority key locally (`.keys/`). Public hosting needs a proper key store.

## Not done yet / next steps

- On-chain gaps: throw line-of-sight/obstacles, pickups and abilities.
- Hosting: deploy the lobby somewhere reachable, with the authority key in a proper secret store, so remote players can join.
- Offline matches still use `LocalDevRandomness` (labelled not verifiable); online matches use MagicBlock VRF.
- Final art/audio: creatures and the dock are primitive blockouts, and the sound is synthesized.
- Balance: bot-only matches currently last ~1–2 min (PRD target 2–4 min with humans). Tune in `config.ts`.
- Camera: the PRD asks for the full arena depth on screen at 50° *and* 60–70% visible width. With an orthographic camera those conflict at 16:9, so full depth wins (~80% width visible). `VIEW_HEIGHT` in `render/Scene.tsx` controls this.
