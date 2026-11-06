# X analytics CRE demo

The page accepts an X post link, signs a post-specific EIP-712 intent, and asks the unpacked extension to open `/analytics`. The extension captures that tab’s `TweetActivityQuery`, encrypts the request URL and session headers for the enclave key, and sends only ciphertext back to the page. The page posts that ciphertext and signed intent to `/cre/trigger`. The dedicated `x-analytics-workflow` decrypts in `handlerInTee`, checks the request is for the signed post, replays it to `https://x.com`, and extracts `UniqueVideoViews` and `VideoCompletions`.

Reward is `VideoCompletions / 1000` USDC. The contract takes 6-decimal units, so 104 completions encode as 104000 units = **0.104 USDC**. `UniqueVideoViews` is displayed, but does not alter payout. The existing `ArcClaimReceiver` is reused. Its `claimedUser` mapping now tracks a commitment to the post ID, limiting this demo to one reward per post. Its 5 USDC per-claim cap and total budget still apply.

## Local setup

1. From `arcStudiotesting`, run `bun install` and `bun run xext:build`. Load `x-analytics-extension` as an unpacked extension in Chrome. Copy its extension ID into the ignored `.env` file as `VITE_X_ANALYTICS_EXTENSION_ID=...`.
2. Run `bun cre-claim/scripts/make-enclave-key.ts --rotate` to rotate the enclave keypair if needed. The script writes both keys to the ignored `.env`; never copy the private key into the extension or page. Restart Vite after rotating.
3. Start `bun run x:bridge` and `bun run dev` from the project root. Set `CRE_TRIGGER_URL=http://127.0.0.1:2003` in `.env` or in the environment for Vite. Sign in to X in the same Chrome profile, connect an Arc Testnet wallet, paste your own video post URL, and press **Get views**.
4. The bridge defaults to `staging-settings` with broadcast enabled. After CRE verifies the replayed metrics, it submits a report through the existing simulation forwarder; the receiver transfers USDC to the signed wallet. The page waits for the receiver's `ClaimPaid` event before reporting success. To run without a transfer, start the bridge with `SIM_TARGET=local-simulation SIM_BROADCAST=false bun run x:bridge`.

The extension only accepts `http://localhost:5173` as its calling page. Use that exact origin. The local bridge is bound to `127.0.0.1`. A successful local simulation is not a production enclave attestation: the configured public key is not verified against a TEE attestation, and a browser extension or page under the account holder's control can be modified. The metric is an authenticated X analytics observation in this demo, not proof that every view came from a distinct human. X can also change its private GraphQL operation without notice.
