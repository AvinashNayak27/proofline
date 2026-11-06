import { App } from '@modelcontextprotocol/ext-apps'

type ClaimData = {
  campaignId?: string
  postUrl?: string
  postId?: string
  postKey?: string
  checkpointUrl?: string
}

const root = document.createElement('main')
root.innerHTML = `
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; }
    main { padding: 16px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 16px; }
    h2 { margin: 0 0 6px; font-size: 18px; }
    p { margin: 5px 0; line-height: 1.45; opacity: .78; }
    ol { margin: 14px 0; padding-left: 24px; }
    li { margin: 7px 0; }
    button { border: 0; border-radius: 999px; padding: 10px 15px; font: inherit; font-weight: 700; cursor: pointer; }
    #authorize { background: #f4ff52; color: #111; }
    #check { background: color-mix(in srgb, currentColor 12%, transparent); color: inherit; margin-left: 7px; }
    button:disabled { cursor: wait; opacity: .55; }
    #status { margin-top: 12px; font-weight: 650; }
    .paid { color: #20a56b; }
    .mono { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
  </style>
  <h2>Complete your Proofline claim</h2>
  <p id="summary">Preparing the human checkpoint…</p>
  <ol>
    <li>Verify with World ID</li>
    <li>Connect and approve your wallet signature</li>
    <li>Capture private X analytics and dispatch CRE</li>
  </ol>
  <button id="authorize" disabled>Verify, sign &amp; run CRE</button>
  <button id="check" disabled>Check reward</button>
  <p id="status" role="status">Waiting for claim details.</p>
  <p id="receipt" class="mono"></p>
`
document.body.append(root)

const authorize = document.querySelector<HTMLButtonElement>('#authorize')!
const check = document.querySelector<HTMLButtonElement>('#check')!
const summary = document.querySelector<HTMLParagraphElement>('#summary')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const receipt = document.querySelector<HTMLParagraphElement>('#receipt')!
const app = new App({ name: 'Proofline Claim', version: '1.0.0' })
let claim: ClaimData = {}
let timer: ReturnType<typeof setInterval> | undefined

function render(data: ClaimData) {
  claim = data
  const ready = Boolean(data.checkpointUrl && data.postUrl)
  authorize.disabled = !ready
  check.disabled = !data.postUrl
  summary.textContent = ready ? `Campaign ${data.campaignId} · X post ${data.postId}` : 'Preparing the human checkpoint…'
  if (ready) status.textContent = 'Ready for your secure approvals.'
}

async function checkReward() {
  if (!claim.postUrl) return
  check.disabled = true
  status.textContent = 'Checking Arc Testnet…'
  try {
    const result = await app.callServerTool({ name: 'check_claim', arguments: { postUrl: claim.postUrl } })
    const data = (result.structuredContent ?? {}) as { rewarded?: boolean; postKey?: string }
    if (data.rewarded) {
      status.textContent = 'Reward confirmed on Arc Testnet.'
      status.className = 'paid'
      receipt.textContent = data.postKey ? `Post key: ${data.postKey}` : ''
      authorize.disabled = true
      if (timer) clearInterval(timer)
    } else {
      status.textContent = 'Not rewarded yet. Complete the checkpoint if it is still open.'
      check.disabled = false
    }
  } catch {
    status.textContent = 'Could not check Arc Testnet. Try again.'
    check.disabled = false
  }
}

authorize.onclick = async () => {
  if (!claim.checkpointUrl) return
  authorize.disabled = true
  status.textContent = 'Complete World ID, wallet, and X approvals in the secure Proofline window.'
  await app.openLink({ url: claim.checkpointUrl })
  timer ??= setInterval(() => void checkReward(), 8_000)
  check.disabled = false
}
check.onclick = () => void checkReward()
app.ontoolresult = (result) => render((result.structuredContent ?? {}) as ClaimData)
await app.connect()
