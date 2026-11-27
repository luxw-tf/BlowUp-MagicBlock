# Submission verification

## Multiplayer findings

| Priority | Finding | State |
| --- | --- | --- |
| Blocker | The reported three-player private room stopped while the lobby waited for accounts before start. The old message was shared by Solana and rollup checks and omitted the match and seat. | The lobby now waits for confirmed base writes, follows the router's published rollup route, and checks the match and occupied players with individual reads. It retries transient reads and reports the layer and affected account. The exact failing read from the reported room is unavailable. A fresh live replay is required. |
| Blocker | Two recent public three-player matches reached their final round but had no base-layer result when checked. In one, the failed `Finalize` passed all six player PDAs. Three were empty and the program rejected the transaction with `AccountDiscriminatorNotFound` (3001). | The current runner derives the exact occupied seats from the final chain roster, including eliminated players. A regression test checks the writable account list for a sparse room. Verify the actual submission lobby runs this revision. |
| High | Clients could enter while the start transaction was still pending, leaving them on an assigning screen if it failed. Aborted matches could also display a winner inferred from the roster. | Clients now wait for live status and handle terminal setup states. Aborted results show that no one won and skip profile credit. The server sends a single timeout abort and checks settlement confirmation and ownership. |
| Medium | Two tabs using the same browser identity could occupy separate seats while both clients resolved to the same first seat. | Private rooms reject the duplicate identity and quick play groups distinct identities. For manual tests, use separate devices, browser profiles or isolated browser contexts. |

Public chain evidence for settlement comes from [the failed Finalize transaction](https://explorer.solana.com/tx/2etKeL3nqbdooGY9roiXRVbnteL4963v57ArJZsMWq9vpXkm7Fx7UVhTQbHmt9E82edsPUbmXjbkB9b5XGceRPKg?cluster=devnet) and [another finished three-player match](https://explorer.solana.com/address/B82m8iwUuno4QNkd2mQvo5m3YA7wbG8Jdf6pVzrBPu7b?cluster=devnet) whose base account was still delegated during the check. These addresses are historical evidence. They are not a confirmed identification of the exact room from the user report.

## Release gate

1. Restart the submission lobby from the exact audited commit and serve its matching production build. Confirm the judge URL reaches that instance.
2. Start a fresh private room with three distinct real browser clients and bot fill off. Verify all three enter, see the same holder and fuse, can move and pass the bomb, and complete both elimination rounds.
3. Check that Match details records a Solana result, that its winner and placements match what players saw, and that there is one result PDA. Verify each opening VRF draw from callback history.
4. Repeat the normal guest quick-play path and test reconnect and bot takeover. Verify a linked-wallet match updates its profile once if wallet progress is included in the demo.

The existing funded harness runs the three-player room scenario with `npx tsx server/test-multiplayer.ts B`. It uses scripted clients. A separate three-browser test is still needed for the submission experience.

## Other open risks

- Online gameplay supports range-checked transfers. Pickups, abilities, and authoritative throw trajectories and obstacle checks are offline or incomplete. Demo language should describe what the online build actually enforces.
- The public tunnel and lobby are instance-dependent. A service restart loses the in-memory room and match registry. A restarted Cloudflare Quick Tunnel gets a new URL.
- Online elapsed results time is client-derived and can undercount on slow or backgrounded tabs. This does not alter chain fuse deadlines. Full six-human remote performance and the sub-100 ms confirmation target remain unverified.
- The production JS chunk is about 1.78 MB before compression, separate from models and textures. Smoke-test first load on the judge's connection and hardware.
