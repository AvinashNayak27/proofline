# Proofline Creator Companion (Chrome extension)

Proofline pays creators by the reach their X posts deliver. To measure a post, the verification workflow needs that post's analytics, which X shows only to the post's owner. This extension lets you share exactly that, safely.

## What it does

- When you submit a post on a Proofline campaign page, the page asks the extension to open that post's `/analytics` tab.
- It captures only the one X request that loads that post's analytics, and nothing else.
- It encrypts the request on the spot to the Proofline workflow's public key, bound to your wallet, the campaign and the post. The page and Proofline's servers only ever handle ciphertext.
- It closes the analytics tab it opened and clears the capture after use.

It needs only the `x.com/i/api/graphql` host permission. It never reads other sites, passwords, or your messages.

## Install (Chrome)

1. From the project root run `bun install` and `bun run ext:build`.
2. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select this `x-analytics-extension` folder.
3. Copy the extension's ID into the project's `.env` as `VITE_PROOFLINE_EXTENSION_ID=...` and restart the dev server.
4. After any rebuild, click **Reload** on the extension.

Use your own X account. Chrome must be signed in to X, and the post must have an Analytics page.

## Allowed pages

The extension only answers pages listed in `manifest.json` (`externally_connectable`) and in `ALLOWED_APP_ORIGINS` in `src/background.ts`. Add your own app origin, for example your tunnel address, to both and reload the extension.
