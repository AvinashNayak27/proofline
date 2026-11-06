/** Fixed vocabulary the sign-in server redirects back with (?auth_error=<code>). */
export const WORLD_ERROR_COPY: Record<string, string> = {
  access_denied: 'World ID sign-in was cancelled.',
  authorization_failed: 'World ID could not complete the sign-in. Try again.',
  invalid_callback: 'The sign-in response was incomplete. Try again.',
  issuer_mismatch: 'The sign-in response did not come from World ID. Try again.',
  state_mismatch: 'That sign-in attempt did not match this browser or has expired. Try again.',
  attempt_expired: 'That sign-in attempt took too long. Try again.',
  service_unavailable: 'World ID is not reachable right now. Try again in a moment.',
  token_exchange_failed: 'World ID could not confirm the sign-in. Try again in a moment.',
  invalid_id_token: 'World ID returned a result that failed verification, so no session was created.',
  insufficient_assurance: 'Proofline needs an Orb-verified World ID, and this account did not meet that requirement.',
}
