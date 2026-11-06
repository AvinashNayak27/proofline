# Proofline

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Proofline is a human-verified, performance-based creator rewards marketplace on Arc Testnet. Tagline: "Brands fund attention. Creators earn from performance."

- Brands create and fund USDC campaigns on `ProoflineCampaigns` (rate per 1,000 unique views, completion-rate bonus, per-post and per-creator caps, minimum views, end date). They can add budget, pause, and close for a refund.
- Creators sign in with World ID (Orb only), connect a wallet, post a video on X containing their Proofline code (derived from campaign + wallet), and submit the link.
- A companion Chrome extension opens the post's own X analytics page, captures that one request and encrypts it to the CRE enclave key.
- The CRE workflow (enclave handler) decrypts it, replays it for views and completions (missing metrics count as 0), checks the public post for the code and author, then signs a report of the MEASUREMENTS. The contract computes the reward from the campaign's own rules and pays the creator.

### Layout
- `contracts/ProoflineCampaigns.sol` (+ `interfaces/IReceiver.sol`): escrow + reward engine. Report = 256-byte abi body (schema v3) + 65-byte signature from `reportSigner` over a chain/contract-bound digest (321 bytes). One reward per post globally; per-creator cap keyed on a World ID commitment. Campaign text is event-only (`CampaignCreated`); rules are stored. Tests in `contracts/test/ProoflineCampaigns*.t.sol`.
- `cre-claim/proofline-workflow/`: CRE workflow (`local-simulation` and `staging-settings` targets). `cre-claim/relay/sim-bridge.ts` runs one simulation per claim; `gateway-relay.ts` signs requests for a deployed workflow. `cre-claim/scripts/` makes the enclave and report-signer keys (secrets go straight to `.env`).
- `server/`: Bun server. World ID OIDC (code flow, S256 PKCE, Orb) in `worldAuth.ts`; `POST /api/claims` requires the session, adds the creator commitment and the campaign's required tag, and forwards to the bridge. Vite proxies `/api`.
- `src/`: pages (`Landing`, `Campaigns`, `CampaignDetail`, `Create`, `Dashboard`, `Rewards`, `Admin`), `components/{layout,ui,campaigns,participate,brand}`, `hooks/`, `lib/proofline/` (abi, events, payout mirror, claim typed data, post code, extension bridge). Chain data is read from events starting at `VITE_PROOFLINE_DEPLOY_BLOCK`.
- `x-analytics-extension/`: Proofline Creator Companion. Allowed pages are listed in `manifest.json` and `ALLOWED_APP_ORIGINS` in `src/background.ts`.
- Claim requests use XHR on purpose (`src/lib/privateHttp.ts`): preview tracing patches fetch and records bodies.
- Browser copies are pinned to workflow code by tests: `src/lib/proofline/{claim,code}.ts` vs `cre-claim/proofline-workflow/src/{intent,proofCode}.ts`, and `src/lib/proofline/payout.ts` mirrors `quote` in the contract.

### Facts verified from official sources
- Arc Testnet CRE name `arc-testnet`, selector 3034092155422581607.
- KeystoneForwarder (deployed) 0x76c9cf548b4179F8901cda1f8623568b58215E62; MockKeystoneForwarder (broadcast simulation) 0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1.
- World ID issuer https://auth.world.org; the callback path is exactly `/api/auth/world/callback`.

### Deployments (Arc Testnet)
- ProoflineCampaigns (simulation: MockKeystoneForwarder, `allowAnyWorkflow=true`): 0xba639d505096fcc005b51ae34f84ee1164068343, deployed 2026-11-06 in block 71066818 (tx 0x015ab507c2d9106f643e1e6d1541528397992c3aef7ae1c95b1b47bbdbd9b98f, metadata `contracts/contract-metadata/ProoflineCampaigns.json`). Owner 0xf7d4041e751E0b4f6eA72Eb82F2b200D278704A4 (the user's wallet). Campaigns need the owner to call `setReportSigner` first (the Admin page does it); the signer address is `VITE_PROOFLINE_REPORT_SIGNER`.
- The workflow is NOT deployed (needs CRE Early Access). The simulation forwarder is public, so rewards are protected by the report-signer signature, and the owner is trusted until `lockWorkflowIdentity`.
- Older contracts from the earlier demo (ArcClaimReceiver) are superseded and not used.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```
