/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed ArcClaimReceiver address on Arc Testnet (public). Optional. */
  readonly VITE_CLAIM_RECEIVER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
