# BlowUp (working title)

Browser party game from `BlowUp-PRD-v0.1.docx`: six creatures, one bomb, a randomized public fuse. This build covers **PRD Phase 01 (playable foundation)** and most of **Phase 02 (gameplay depth)** as a local match: one human + five bots.

```bash
npm install
npm run dev        # http://localhost:5173  (add ?quick to skip menus)
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

## Not done yet / next steps

- **Phase 03 (live multiplayer)**: connect the browser client to the deployed program. The game client still uses `LocalDevRandomness`, and its match-details panel says results are **not verifiable**. Swap in an ER-backed session plus VRF-backed randomness. Design around the measured latency (see findings).
- On-chain gaps: throw line-of-sight/obstacles, pickups and abilities, disconnect/bot takeover.
- Live multiplayer, private rooms, reconnect/bot takeover. The lobby always fills with bots.
- Final art/audio: creatures and the dock are primitive blockouts, and the sound is synthesized.
- Balance: bot-only matches currently last ~1–2 min (PRD target 2–4 min with humans). Tune in `config.ts`.
- Camera: the PRD asks for the full arena depth on screen at 50° *and* 60–70% visible width. With an orthographic camera those conflict at 16:9, so full depth wins (~80% width visible). `VIEW_HEIGHT` in `render/Scene.tsx` controls this.
