# Phase 00 — MagicBlock feasibility findings

*Devnet, 2026-11-25. Program `915f4aBTkrJaZ4ym6D85AoNLHQwazUC3vmbjgQNyhyob`, ER validator `devnet-as` (MagicBlock validator 2.0.5). Measured from a single client machine in Asia with `chain/feasibility.ts`; raw reports in `chain/reports/`.*

## Verdict

The PRD's on-chain architecture works end to end. A six-player match runs on an Ephemeral Rollup: guests need no wallet and no SOL; bomb holder and fuse lengths come from MagicBlock VRF; ownership and eliminations are enforced on-chain; the result settles idempotently on Solana. **One PRD target is not met:** input confirmation p95 < 100 ms. That is the main risk to carry into Phase 03.

## What the PRD asked Phase 00 to answer

| Question (PRD §14/§18) | Result |
|---|---|
| Minimal Anchor program + delegation | ✅ 7 accounts (match + 6 players) delegate in one flow; router sees delegation ~180–630 ms after base confirmation |
| Live ER updates | ✅ Works. See latency below; target missed |
| VRF latency | ✅ Fuse draw p50 ≈ 0.53–0.56 s across runs; p95 varied 0.7–1.8 s. Holder draw ≈ 0.5 s (≈ 0.8 s from the elimination request, max seen 1.4 s). 0 retries across all runs. Gameplay must tolerate a visible "arming" beat of up to ~2 s |
| Guest sponsorship | ✅ Lobby authority pays rent and delegation. **Unfunded guest keys can pay their own ER transactions** (ER fees are 0), so no relayer is needed for gameplay |
| Session expiry | ✅ Enforced on-chain and renewable by the guest's own identity key. Note: ER clock skew (below) |
| Invalid inputs can't manipulate ownership | ✅ Duplicate/stale sequence, teleport, out of bounds, foreign signer, non-holder transfer, transfer after expiry, immediate tag-back all rejected |
| Settlement idempotent and verifiable | ✅ Commit + undelegate back to Solana in ~2.6–2.8 s; `record_result` writes a `MatchResult` PDA whose winner matches ER state; a second record is rejected |

## Latency (6 players × 20 Hz × 5 s, final run)

| Metric | p50 | p95 | p99 |
|---|---|---|---|
| Send → confirmed (client polling) | 196 ms | 453 ms | 900 ms |
| Send → visible to a subscriber (websocket) | 108 ms | 163 ms | 223 ms |

The subscription figure is the one that matters for other players. It includes the client↔server round trip (here, one machine to `devnet-as`), so it is an upper bound for players near the validator. Even so, **p95 < 100 ms is not met**. Implications for Phase 03:

- Keep the browser simulation authoritative for *feel* (prediction + interpolation already exist) and the ER authoritative for *outcomes*. That is already the PRD's split.
- Send movement less often than 20 Hz (positions are absolute, so 10 Hz loses little), and keep tag/throw as immediate transactions.
- Measure again from clients near each region; route players to the nearest ER via the router.

About 5–6% of 20 Hz inputs arrive out of order and are correctly dropped as `StaleSequence`. Inputs carry absolute positions, so nothing is lost. The client should treat this as normal, not as an error.

## Pitfalls found (all fixed)

1. **`#[vrf_callback]` exhausts compute.** The SDK 0.18 macro injects `address = scoped_vrf_identity_const(&crate::ID)` inline in Anchor's account checks, which is not a `const` context. The PDA derivation then runs on-chain and burned the whole ~270k CU callback budget (`ProgramFailedToComplete`). Fix: declare `vrf_program_identity` yourself against a compile-time `const`; the macro then skips its injection. This also shrank the program by 30 KB.
2. **Raw VRF bytes read naively look non-uniform.** Reading the first 4 bytes of the output as a u32, 20 holder draws had mean 0.37 and none above 0.76 (p ≈ 0.4% if uniform). The SDK's own helpers read from the tail. Draws are now `sha256("blowup" ‖ tag ‖ randomness)` with per-purpose tags. `chain/verify-draws.ts` recomputes every holder pick and starting fuse from the callback data; on the verification run all 5 matched the on-chain values and draws spanned 0.17–0.99.
3. **ER `Clock.unix_timestamp` is offset by about −51 s** from wall time (stable, advances at real speed). Fine for multi-hour session expiry; don't use it for sub-minute timing.
4. **ER slots are ~10 ms.** Game deadlines are in slots, converted with the route's `blockTimeMs`, which matched the measured rate.
5. **Movement window was too generous.** Crediting up to 1 s at dash speed let a 15-unit teleport through after idling; capped at 300 ms.
6. **Tooling:** public devnet RPC rate-limits status polling (use MagicBlock's RPC, poll base gently); `GetCommitmentSignature` needs a `confirmed` connection; load-balanced RPC reads can lag a confirmed write; Anchor 1.0.2 needs platform-tools v1.52 (manual download if `cargo-build-sbf` times out).

## Not covered yet

- Throw line-of-sight and obstacles are range-checked only; pickups and abilities are not on-chain.
- Six *remote humans* in one match (only one client machine was used).
- Disconnect / bot takeover, ER outage handling beyond `abort_match`.
- Browser client integration (Phase 03).
