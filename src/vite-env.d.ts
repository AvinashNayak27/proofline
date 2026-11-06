/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public X25519 key (0x + 64 hex) of the CRE enclave. Creators' X session captures are encrypted to it. */
  readonly VITE_ENCLAVE_PUBLIC_KEY?: string
  /** Chrome extension ID of the Proofline creator companion. VITE_X_ANALYTICS_EXTENSION_ID is the older name. */
  readonly VITE_PROOFLINE_EXTENSION_ID?: string
  readonly VITE_X_ANALYTICS_EXTENSION_ID?: string
  /** Deployed ProoflineCampaigns address on Arc Testnet (public). */
  readonly VITE_PROOFLINE_CONTRACT?: string
  /** Block the contract was deployed in; event reads start here, never at block 0. */
  readonly VITE_PROOFLINE_DEPLOY_BLOCK?: string
  /** Address (not key) of the report signer the contract owner registers. Shown on the admin page. */
  readonly VITE_PROOFLINE_REPORT_SIGNER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
