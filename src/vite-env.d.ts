/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed ArcClaimReceiver address on Arc Testnet (public). Optional. */
  readonly VITE_CLAIM_RECEIVER?: string
  /** Public X25519 key (0x + 64 hex) of the CRE enclave. The access token is encrypted to it. */
  readonly VITE_ENCLAVE_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
