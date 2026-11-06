# Proofline

**Brands fund attention. Creators earn from performance.**

Proofline is a human-verified, performance-based creator rewards marketplace on Arc. Brands create and fund USDC campaigns with transparent payout rules. Creators sign in with World ID, post about a campaign on X, and have their reach measured by a Chainlink CRE workflow. Rewards are paid in USDC the moment a post is verified.

Built with [Arc Studio](https://studio.arc.io)

Testnet only. Proofline runs on Arc Testnet with test USDC. Do not use real funds.

## What you can do

- **Brands:** launch a campaign, set the rate per 1,000 views, a completion bonus, per-post and per-creator caps, and a minimum view count. Top up, pause, or close the campaign and get the unspent budget back.
- **Creators:** sign in with an Orb-verified World ID, pick a campaign, post on X with your Proofline code, submit the link, and get paid.
- **Everyone:** browse live campaigns and see every payout onchain.

## Tech stack

- React, Vite, TypeScript, Tailwind CSS, React Router, wagmi, viem, ConnectKit
- Solidity 0.8.28 with Foundry: the `ProoflineCampaigns` escrow and reward contract in `contracts/`
- Chainlink CRE TypeScript workflow in `cre-claim/proofline-workflow/` (runs in an enclave handler)
- Bun server for World ID sign-in and claim submission in `server/`
- Chrome companion extension in `x-analytics-extension/`

## Development

Prerequisites: Bun, Foundry, the CRE CLI (`cre`, logged in with `cre login` or a `CRE_API_KEY`), and Chrome for the companion extension.

```bash
bun install
bun run dev              # app on http://localhost:5173
bun run server           # World ID sign-in and claim submission (proxied by the dev server)
bun run cre:bridge       # runs the CRE workflow for each claim and returns the result
bun run check            # lint and typecheck
bun run contracts:build  # compile contracts
bun run contracts:test   # contract tests
bun run server:test      # server and app logic tests
bun run cre:test         # workflow and relay tests
bun run ext:build        # build the companion extension
```

One-time key setup (each prints only a public value and writes the secret to `.env`):

```bash
bun cre-claim/scripts/make-enclave-key.ts     # key the creator's X capture is encrypted to
bun cre-claim/scripts/make-report-signer.ts   # key that signs reward reports; prints its address
```

The contract owner registers the report signer address once on the `/admin` page (or with `setReportSigner`). Campaigns can be created after that.

Sign-in needs a public HTTPS address for the World ID redirect, for example a tunnel to port 5173. Register `<your origin>/api/auth/world/callback` in the World ID developer portal and set `WORLD_ID_REDIRECT_URI` to the same value.

Companion extension: run `bun run ext:build`, then in `chrome://extensions` turn on Developer mode and Load unpacked from `x-analytics-extension/`. Put its ID in `VITE_PROOFLINE_EXTENSION_ID`. See `x-analytics-extension/README.md`.

### Environment variables

Copy `.env.local.example` to `.env.local` and fill it in. Never commit real values.

| Name | Purpose |
| --- | --- |
| `WORLD_ID_CLIENT_ID`, `WORLD_ID_CLIENT_SECRET` | Required. Credentials of your World ID app. Server side only. |
| `WORLD_ID_REDIRECT_URI` | Required. Exact callback URL registered in the portal, ending in `/api/auth/world/callback`. |
| `WORLD_ID_SESSION_SECRET` | Required. Random string of at least 32 characters that signs the session cookie. |
| `VITE_PROOFLINE_CONTRACT`, `VITE_PROOFLINE_DEPLOY_BLOCK` | Required. Deployed `ProoflineCampaigns` address and the block it was deployed in. |
| `VITE_ENCLAVE_PUBLIC_KEY` | Required. Public key creators' X captures are encrypted to. |
| `VITE_PROOFLINE_EXTENSION_ID` | Required for creators. Chrome ID of the companion extension. `VITE_X_ANALYTICS_EXTENSION_ID` is accepted as an older name. |
| `VITE_PROOFLINE_REPORT_SIGNER` | Optional. Report signer address, shown on the admin page. |
| `ENCLAVE_PRIVATE_KEY`, `REPORT_SIGNER_PRIVATE_KEY` | Workflow only. Read by the CRE CLI in simulation. Keep them secret. |
| `AUTH_SERVER_PORT` | Optional. Port of the Bun server. Defaults to 3001. |
| `CRE_TRIGGER_URL` | Optional. Where the server sends claims: the bridge (`http://127.0.0.1:2003`) or the signing relay (`http://127.0.0.1:2001`). |
| `SIM_TARGET`, `SIM_BROADCAST`, `BRIDGE_PORT` | Bridge only. Workflow target (default `staging-settings`), whether to broadcast, and its port (default 2002; use 2003 with the server default). |
| `CRE_ETH_PRIVATE_KEY` | Bridge only. Funded testnet key the CRE CLI uses to broadcast. |
| `CRE_TRIGGER_PRIVATE_KEY`, `CRE_GATEWAY_URL`, `CRE_WORKFLOW_ID`, `RELAY_PORT` | Signing relay only, for a deployed workflow. |
| `RPC_URL_Arc_Testnet`, `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Optional. RPC overrides for the server. Provisioned automatically inside Arc Studio. |

## Privacy and trust

- Creators are identified to the contract only by a one-way commitment to their World ID. No handle, tweet text or World ID subject goes onchain.
- Your X analytics are captured by your own browser and encrypted before they leave it. Only the enclave workflow can open them.
- The contract, not the workflow, computes every reward from the campaign's public rules. The workflow only reports measurements, signed with a key that the contract checks.
- Signing out ends this app's session. It does not sign you out of World ID.
