# DummyJSON to Arc claim (testnet demo)

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

A browser UI where a DummyJSON user signs in, signs an EIP-712 claim intent with an Arc Testnet wallet, and posts token + signature to a Chainlink CRE HTTP-triggered workflow. The workflow verifies the signature, calls DummyJSON auth/me and reads the user `id` and `weight` (no username check), computes payout = weight / 100 USDC rounded down to 6 decimals, rejects missing/non-positive/over-cap weights, then (production mode) writes a CRE report that makes `ArcClaimReceiver` pay that amount once per user commitment (keccak256(abi.encode(application, userId))). TESTNET ONLY. TESTNET ONLY.

### Layout
- `contracts/ArcClaimReceiver.sol` (+ `interfaces/IReceiver.sol`): receiver. USDC via the ERC-20 interface (0x3600...0000, 6 decimals), immutable forwarder, `allowAnyWorkflow` immutable (true only for MockKeystoneForwarder simulation deployments), fails closed until expected workflow owner/ID is set. Report schema v2 = abi.encode(uint8 version=2, bytes32 claimId, bytes32 userCommitment, address recipient, uint256 amount, uint256 expiry) (192 bytes). Owner-set caps: maxRewardBudget (lifetime) and maxClaimAmount (per claim). Constructor: (forwarder, usdc, owner, maxRewardBudget, maxClaimAmount, allowAnyWorkflow).
- `cre-claim/` CRE project. Workflow in `claim-workflow/` (targets `local-simulation` and `staging-settings`). `relay/gateway-relay.ts` signs requests for deployed workflows. `scripts/make-sim-payload.ts` builds local payloads (git-ignored `payloads/`).
- `src/lib/claimIntent.ts` mirrors `cre-claim/claim-workflow/src/intent.ts`; a test pins them together.
- Login and trigger calls use XHR on purpose (`src/lib/privateHttp.ts`): preview tracing patches fetch and records bodies.

### Facts verified from official sources
- Arc Testnet CRE name `arc-testnet`, selector 3034092155422581607 (also checked with `cre workflow supported-chains`).
- KeystoneForwarder (deployed) 0x76c9cf548b4179F8901cda1f8623568b58215E62; MockKeystoneForwarder (broadcast simulation) 0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1.

### Deployments (Arc Testnet, 2026-11-06; deployed by the platform wallet, owner = 0xf7d4041e751E0b4f6eA72Eb82F2b200D278704A4)
Current (v2, variable payout weight/100 USDC, one per user; budget 5 USDC, max per claim 5 USDC):
- Simulation receiver (MockKeystoneForwarder 0x6E9E...eDc1, allowAnyWorkflow=true): 0x4723ddaf8c63fc58d304cdb84f1c5890233642af, tx 0xb1ef4aca6bd3064c45c6de764e69d050b2fc18f5bbcb95cbd6633ac40a961f49 (metadata: contracts/contract-metadata/ArcClaimReceiver.v2-simulation.json). Used by VITE_CLAIM_RECEIVER and config.staging.json.
- Production receiver (KeystoneForwarder 0x76c9...1E62, allowAnyWorkflow=false): 0xc4fa9e11af4024a07645d24716e9eb76ebd81bca, tx 0x2eb6306d18da5a537ddcfdc5c7c6124d23dd581f246b0b4c65e2b4c772dcb2ee. Rejects every report until the owner calls setExpectedWorkflowId / setExpectedWorkflowOwner.
Superseded (v1, fixed 1 USDC, oliviaw only, do not use): 0x22c081a3a58045aff5ec6465676b29db13bf3289 (holds 2 USDC, owner can withdraw) and 0xcdddef3f15ad92fc223f9968ae750a8469be6a3f.
- Workflow NOT deployed (needs CRE Early Access); no workflow ID; registry `private` is configured in workflow.yaml.

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
