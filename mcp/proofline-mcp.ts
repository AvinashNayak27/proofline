import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { createPublicClient, http, isAddress, type Address } from 'viem'
import { prooflineAbi, STATUS } from '../src/lib/proofline/abi'
import { findCreationBlock, readCreated } from '../src/lib/proofline/discovery'
import { parsePostUrl, postKey } from '../src/lib/proofline/claim'
import { rpcUrl } from '../server/campaignChain'

const PORT = Number(process.env.MCP_PORT ?? 8787)
const MCP_PATH = '/mcp'
const CLAIM_WIDGET_URI = 'ui://proofline/claim-v1.html'
const claimWidgetScript = readFileSync(new URL('./dist/claim-widget.js', import.meta.url), 'utf8').replace(/<\/script/gi, '<\\/script')
const contractValue = process.env.VITE_PROOFLINE_CONTRACT
const deployBlockValue = process.env.VITE_PROOFLINE_DEPLOY_BLOCK
const CONTRACT: Address | null = typeof contractValue === 'string' && isAddress(contractValue) ? contractValue : null
const DEPLOY_BLOCK = typeof deployBlockValue === 'string' && /^[0-9]{1,12}$/.test(deployBlockValue) ? BigInt(deployBlockValue) : null
const APP_ORIGIN = (() => {
  const explicit = process.env.PROOFLINE_APP_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const callback = process.env.WORLD_ID_REDIRECT_URI
  if (callback) return new URL(callback).origin
  return 'http://localhost:5173'
})()

const client = createPublicClient({ transport: http(rpcUrl()) })

function requireContract(): Address {
  if (!CONTRACT || DEPLOY_BLOCK === null) throw new Error('Proofline contract configuration is missing')
  return CONTRACT
}

const reply = (message: string, data?: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: message }],
  ...(data ? { structuredContent: data } : {}),
})

async function readCampaign(id: bigint) {
  const contract = requireContract()
  const head = await client.getBlockNumber()
  const [state, remaining, createdBlock] = await Promise.all([
    client.readContract({ address: contract, abi: prooflineAbi, functionName: 'getCampaign', args: [id], blockNumber: head }),
    client.readContract({ address: contract, abi: prooflineAbi, functionName: 'remaining', args: [id], blockNumber: head }),
    findCreationBlock(client, contract, id, DEPLOY_BLOCK as bigint, head),
  ])
  const created = await readCreated(client, contract, id, createdBlock)
  const now = Math.floor(Date.now() / 1000)
  const phase = state.status === STATUS.Closed
    ? 'closed'
    : state.status === STATUS.Paused
      ? 'paused'
      : now < Number(state.startsAt)
        ? 'upcoming'
        : now >= Number(state.endsAt)
          ? 'ended'
          : remaining === 0n
            ? 'exhausted'
            : 'live'
  return { state, remaining, created, phase }
}

function makeMcpServer() {
  const server = new McpServer(
    { name: 'proofline-creator-agent', version: '0.1.0' },
    {
      instructions:
        'Help creators inspect Proofline campaigns and prepare claims. A claim is never complete until the human finishes the World ID, wallet-signature, and private X analytics checkpoint in the returned Proofline URL, and check_claim confirms the reward on Arc Testnet.',
    },
  )

  registerAppResource(
    server,
    'proofline-claim-widget',
    CLAIM_WIDGET_URI,
    {},
    async () => ({
      contents: [{
        uri: CLAIM_WIDGET_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><script type="module">${claimWidgetScript}</script></body></html>`,
        _meta: { ui: { prefersBorder: false, csp: { connectDomains: [APP_ORIGIN] } } },
      }],
    }),
  )

  server.registerTool(
    'inspect_campaign',
    {
      title: 'Inspect Proofline campaign',
      description: 'Reads one Proofline campaign and its immutable payout rules from Arc Testnet.',
      inputSchema: { campaignId: z.string().regex(/^[1-9][0-9]{0,17}$/) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ campaignId }) => {
      try {
        const { state, remaining, created, phase } = await readCampaign(BigInt(campaignId))
        const d = created.args.data
        const data = {
          campaignId,
          title: d.title,
          brandName: d.brandName,
          brief: d.brief,
          requiredTag: d.requiredTag,
          requireProofCode: state.requireProofCode,
          phase,
          minViews: state.minViews,
          bonusBps: state.bonusBps,
          cpmUsdc6: state.cpmUsdc6.toString(),
          maxPerPostUsdc6: state.maxPerPost.toString(),
          maxPerCreatorUsdc6: state.maxPerCreator.toString(),
          remainingUsdc6: remaining.toString(),
          startsAt: state.startsAt.toString(),
          endsAt: state.endsAt.toString(),
          campaignUrl: `${APP_ORIGIN}/campaigns/${campaignId}`,
        }
        return reply(`Campaign ${campaignId} is ${phase}: ${d.title}`, data)
      } catch {
        return { ...reply(`Campaign ${campaignId} could not be read from Arc Testnet.`), isError: true }
      }
    },
  )

  registerAppTool(
    server,
    'prepare_claim',
    {
      title: 'Prepare creator claim',
      description: 'Validates the campaign and post link, then creates the browser checkpoint where the creator must complete World ID, wallet signing, and private analytics capture.',
      inputSchema: {
        campaignId: z.string().regex(/^[1-9][0-9]{0,17}$/),
        postUrl: z.string().max(256),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      _meta: {
        ui: { resourceUri: CLAIM_WIDGET_URI },
        'openai/outputTemplate': CLAIM_WIDGET_URI,
        'openai/toolInvocation/invoking': 'Preparing your Proofline claim…',
        'openai/toolInvocation/invoked': 'Claim checkpoint ready',
      },
    },
    async ({ campaignId, postUrl }) => {
      const parsed = parsePostUrl(postUrl)
      if (!parsed) return { ...reply('Use a plain X post URL such as https://x.com/name/status/123.'), isError: true }
      try {
        const c = await readCampaign(BigInt(campaignId))
        if (c.phase !== 'live') return { ...reply(`Campaign ${campaignId} is ${c.phase} and cannot accept a claim.`), isError: true }
        const url = new URL(`/campaigns/${campaignId}`, `${APP_ORIGIN}/`)
        url.searchParams.set('post', postUrl)
        url.searchParams.set('from', 'chatgpt')
        const data = {
          campaignId,
          postUrl,
          postId: parsed.postId,
          postKey: postKey(parsed.postId),
          checkpointUrl: url.toString(),
          checkpoint: 'World ID + wallet signature + encrypted X analytics',
        }
        return reply('The claim is prepared but not authorized. Open checkpointUrl and complete every human step, then ask me to check the claim.', data)
      } catch {
        return { ...reply(`Campaign ${campaignId} could not be validated.`), isError: true }
      }
    },
  )

  server.registerTool(
    'check_claim',
    {
      title: 'Check creator claim',
      description: 'Checks Arc Testnet to confirm whether the post has received its one-time Proofline reward.',
      inputSchema: { postUrl: z.string().max(256) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ postUrl }) => {
      const parsed = parsePostUrl(postUrl)
      if (!parsed) return { ...reply('Use a plain X post URL such as https://x.com/name/status/123.'), isError: true }
      try {
        const contract = requireContract()
        const key = postKey(parsed.postId)
        const rewarded = await client.readContract({ address: contract, abi: prooflineAbi, functionName: 'postRewarded', args: [key] })
        return reply(
          rewarded ? 'Arc Testnet confirms this post was rewarded.' : 'No reward is recorded yet. The human checkpoint may still be pending or the claim may have failed.',
          { postUrl, postId: parsed.postId, postKey: key, rewarded },
        )
      } catch {
        return { ...reply('The claim status could not be read from Arc Testnet.'), isError: true }
      }
    },
  )

  return server
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ name: 'Proofline Creator Agent', mcp: MCP_PATH }))
    return
  }
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    })
    res.end()
    return
  }
  if (url.pathname === MCP_PATH && req.method && ['POST', 'GET', 'DELETE'].includes(req.method)) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
    const server = makeMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch {
      if (!res.headersSent) res.writeHead(500).end('Internal server error')
    }
    return
  }
  res.writeHead(404).end('Not Found')
})

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`Proofline MCP server listening on http://127.0.0.1:${PORT}${MCP_PATH}`)
})
