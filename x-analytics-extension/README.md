# X Analytics Attester extension (local demo)

Run `bun run xext:build` from the project root. In Chrome, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked** for this directory. After rebuilding, click **Reload** for the extension. Put its ID in the ignored project `.env` as `VITE_X_ANALYTICS_EXTENSION_ID=...` and restart Vite.

The app at `http://localhost:5173` (or the Arc Studio preview origin listed in `manifest.json`) sends a post URL and signed claim binding to this extension. It opens that post's `/analytics` tab. When that tab sends `TweetActivityQuery` for the same post, the extension immediately encrypts the request URL and necessary session headers to `VITE_ENCLAVE_PUBLIC_KEY`. Only ciphertext is stored in `chrome.storage.session` and returned to the app. After the app receives the encrypted capture, the extension closes the analytics tab it opened. A new capture clears the previous one.

Use your own X account for this local test. Chrome must be signed into X and the post must have an analytics page. The extension needs only the listed X GraphQL host permission. The private session values are not displayed in the app or bridge logs. This simulation does not verify the enclave public key against a hardware attestation.
