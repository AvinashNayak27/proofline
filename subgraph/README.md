# Proofline Arc Testnet Subgraph

Indexes `CampaignCreated` and `PostRewarded` from `ProoflineCampaigns` on Arc Testnet. It supports direct reward lookup by payout wallet or opaque World ID creator commitment without scanning Arc RPC logs in the browser.

## Build

```bash
bun install
bun run codegen
bun run build
```

## Deploy to Subgraph Studio

Create a subgraph in [Subgraph Studio](https://thegraph.com/studio/), copy its slug and deploy key, then run:

```bash
bunx graph auth <DEPLOY_KEY>
bunx graph deploy <SUBGRAPH_SLUG> --version-label 0.1.0
```

Never commit the deploy key or a Graph query API key. Use the Studio development query URL for Arc Testnet and configure that URL in Proofline after deployment.

Configure the Proofline server after deployment:

```env
PROOFLINE_SUBGRAPH_URL=https://api.studio.thegraph.com/query/<ID>/<SUBGRAPH_NAME>/<VERSION>
GRAPH_API_KEY=<QUERY_API_KEY>
```

Example wallet and creator queries are in `queries.graphql`. Graph `Bytes` identifiers must be lowercase `0x` hex strings.
