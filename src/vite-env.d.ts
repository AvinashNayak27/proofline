/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed ArcClaimReceiver address on Arc Testnet (public). Optional. */
  readonly VITE_CLAIM_RECEIVER?: string
  /** Public X25519 key (0x + 64 hex) of the CRE enclave. The X analytics session request is encrypted to it. */
  readonly VITE_ENCLAVE_PUBLIC_KEY?: string
  readonly VITE_X_ANALYTICS_EXTENSION_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
