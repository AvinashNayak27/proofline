/** What each workflow rejection means for the creator, in plain words. Keys are the fixed reasons the workflow returns. */
export const REJECTION_COPY: Record<string, string> = {
  invalid_request: 'The submission was not valid. Check the post link and try again.',
  intent_expired: 'Your signature expired before the check finished. Start again.',
  bad_signature: 'The wallet signature did not verify. Start again.',
  campaign_not_found: 'That campaign could not be found onchain.',
  campaign_inactive: 'This campaign is paused or closed, so it is not accepting posts right now.',
  campaign_not_open: 'This campaign is not open for posts right now. Check its dates.',
  already_claimed: 'This post has already been rewarded.',
  session_unreadable: 'Your X session could not be read. Reload the extension and this page, then try again.',
  unauthorized: 'X did not accept your session. Sign in to X in this browser and make sure this is your own post.',
  request_failed: 'X did not return analytics for this post. Try again in a moment.',
  invalid_response: 'X returned something unexpected. Try again in a moment.',
  metrics_missing: 'X did not return analytics for this post. Make sure it is your own post with an Analytics page.',
  tweet_unreadable: 'The post could not be read publicly. Make sure it is public and not deleted.',
  tweet_mismatch: 'The post link does not match the account or post that was checked.',
  code_missing: 'Your Proofline code was not found in the post. Add the code exactly as shown, post again, and resubmit.',
  tag_missing: 'The campaign tag was not found in the post. Add it and resubmit.',
  below_min_views: 'This post has not reached the campaign minimum of unique views yet.',
  creator_cap_reached: 'You have already earned the maximum this campaign pays per creator.',
  budget_exhausted: 'This campaign has no budget left.',
  nothing_to_pay: 'This post would earn nothing under the campaign rules.',
  delivery_reverted: 'The payout was rejected by the contract. The post may already have been rewarded or the campaign may have just closed.',
}

/** HTTP errors from the Proofline server. */
export const SERVER_COPY: Record<string, string> = {
  world_id_required: 'Your World ID session ended. Sign in again to continue.',
  slow_down: 'Please wait a few seconds before submitting again.',
  busy: 'Proofline is verifying other posts right now. Try again in a minute.',
  not_configured: 'Proofline is not fully configured on the server yet.',
  campaign_unreadable: 'The campaign could not be read from Arc Testnet. Try again in a moment.',
  bridge_unreachable: 'The verification service is not reachable right now. Try again in a moment.',
  forbidden: 'This page is not allowed to submit claims.',
}
