# DummyJSON to Arc claim (testnet demo)

A testnet-only demo where a user signs in to DummyJSON, connects an Arc Testnet wallet, signs a claim, and receives a USDC reward equal to their DummyJSON profile weight divided by 100 (for example weight 58 pays 0.58 USDC), once per user, if a Chainlink CRE workflow verifies the login. The DummyJSON access token is encrypted in the browser to a key held by the CRE enclave, so only the enclave can read it. Passwords go only from the browser to DummyJSON, and nothing identifying is written onchain.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit
- Solidity 0.8.28 with Foundry (contract and tests in `contracts/`)
- Chainlink CRE TypeScript workflow in `cre-claim/` (CRE CLI)

## Development

Prerequisites: Bun, Foundry, and the CRE CLI (`cre`, logged in with `cre login`).

```bash
bun install
bun run dev              # app on http://localhost:5173
bun run check            # lint and typecheck
bun run contracts:build  # compile contracts
bun run contracts:test   # contract unit tests
bun run cre:test         # workflow and relay tests
bun cre-claim/scripts/make-enclave-key.ts   # one-time: create the enclave keypair (writes .env, prints only the public key)
bun run cre:simulate     # run the workflow locally in listen mode (no deployment, no transactions)
bun run cre:bridge       # local bridge that runs one simulation per claim and returns the real result
bun run cre:relay        # signing relay for a deployed workflow (see below)
```

When `VITE_CLAIM_RECEIVER` is set, the app also shows the live reward pool and a "Fund pool" button that sends USDC from your connected wallet to the receiver as an ERC-20 transfer. Plain native sends to the receiver revert on purpose.

Local flow: run `bun run cre:bridge` in one terminal and `bun run dev` in another, with `CRE_TRIGGER_URL=http://127.0.0.1:2002` in `.env`. Each claim runs one simulation and the app shows the real outcome right away: paid, or not eligible. By default the bridge uses the staging target and broadcasts the report through the mock forwarder, which sends a real testnet transaction. Set `SIM_TARGET=local-simulation` for a dry run that sends nothing. Plain `bun run cre:simulate` also works, but it answers every request with an empty response, so the app can only wait for a payout.

A deployed workflow only accepts requests signed by an authorized key. Run `bun run cre:relay` and start the app with `CRE_TRIGGER_URL=http://127.0.0.1:2001` so the relay signs requests; the browser never holds that key.

### Environment variables

| Name | Purpose |
| --- | --- |
| `VITE_CLAIM_RECEIVER` | Optional. Deployed receiver contract address on Arc Testnet. Enables the live reward pool and payout confirmation. |
| `VITE_ENCLAVE_PUBLIC_KEY` | Required to claim. Public key of the CRE enclave (0x + 64 hex). The app encrypts the access token to it. Created by `make-enclave-key.ts`. |
| `ENCLAVE_PRIVATE_KEY` | Workflow and bridge only. Private half of the enclave key, read by the CRE CLI during simulation. Never commit or share it. For a deployed workflow, upload it with `cre secrets create`. |
| `CRE_TRIGGER_URL` | Optional. Where the dev server forwards `/cre/trigger`. Defaults to the local simulator on port 2000; use `http://127.0.0.1:2002` for the bridge or `http://127.0.0.1:2001` for the signing relay. |
| `SIM_TARGET`, `SIM_BROADCAST`, `BRIDGE_PORT` | Bridge only. Workflow target (default `staging-settings`), whether to broadcast, and the port (default 2002). |
| `CRE_TRIGGER_PRIVATE_KEY` | Relay only. Key authorized to trigger the deployed workflow. Keep it in your own environment, never in chat or git. |
| `CRE_GATEWAY_URL` | Relay only. Gateway URL for your CRE environment. |
| `CRE_WORKFLOW_ID` | Relay only. 64-character workflow ID printed on deploy. |
| `RELAY_PORT` | Relay only. Defaults to 2001. |
| `DUMMYJSON_USERNAME`, `DUMMYJSON_PASSWORD` | Only for `cre-claim/scripts/make-sim-payload.ts`, which builds a local test payload. |

## Privacy notes

- The app never sends the DummyJSON access token in readable form. It encrypts the token in the browser to the enclave's public key, binds it to the wallet, nonce and expiry you sign, and sends only that encrypted session material. The enclave decrypts it, calls DummyJSON, and works out the payout. Only the opaque claim id, wallet, amount and expiry leave the enclave.
- Simulation uses the CRE simulator, which is not a real enclave and is for debugging only. A live deployment of this workflow needs Confidential Workflows access (private beta) and the private key stored as a CRE secret.
- Passwords go only from the browser to DummyJSON. The app sends login and trigger requests with XMLHttpRequest so the preview's request tracing does not record the password or the encrypted session material.

Testnet only. Do not use with real funds.
