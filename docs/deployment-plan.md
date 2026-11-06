# Proposed actions (nothing below has been run)

Every step needs your explicit confirmation first. All steps are Arc Testnet (chain 5042002) only. Nothing touches mainnet, and no wallet from another session is used.

Verified values (official CRE forwarder directory and `cre workflow supported-chains`):

| Item | Value |
| --- | --- |
| CRE chain name / selector | `arc-testnet` / 3034092155422581607 |
| KeystoneForwarder (deployed workflows) | `0x76c9cf548b4179F8901cda1f8623568b58215E62` |
| MockKeystoneForwarder (`--broadcast` simulation) | `0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1` |
| USDC ERC-20 interface (6 decimals) | `0x3600000000000000000000000000000000000000` |
| RPC | `https://rpc.testnet.arc.io` |

## Your wallet, kept local

The deployer key must never enter chat. Two ways, your choice:

1. Recommended: run the deploy on your own machine with a Foundry keystore (`cast wallet import arc-deployer --interactive` prompts for the key locally).
2. Put the key in `.env` yourself from the Code panel and tell me it is saved. I will use it only through the environment and never read it.

## A. Deploy a simulation receiver (mock forwarder)

```
forge create contracts/ArcClaimReceiver.sol:ArcClaimReceiver \
  --rpc-url https://rpc.testnet.arc.io --account arc-deployer --broadcast \
  --constructor-args 0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1 \
                     0x3600000000000000000000000000000000000000 \
                     <YOUR_WALLET> 5000000 true
```

Arguments: forwarder, USDC, owner (your wallet), max reward budget 5 USDC (5000000), `allowAnyWorkflow = true` (mock forwarder supplies no workflow metadata, so this variant is for simulation only).

## B. Fund the receiver

ERC-20 transfer of 3 USDC (3000000) from your wallet to the receiver. Do not send native value: the contract has no receive function.

## C. Broadcast simulation (sends one real testnet transaction)

Set the receiver address and a key for the CLI in `cre-claim/claim-workflow/config.staging.json` (receiver, an authorized key address) and the CLI's `.env` (`CRE_ETH_PRIVATE_KEY`, funded, yours). Then:

```
cre workflow simulate claim-workflow --target staging-settings --non-interactive --trigger-index 0 --http-payload <payload.json> --broadcast
```

## D. Production receiver and workflow deploy (needs Early Access)

1. `cre account access` checks status and, when unavailable, interactively submits a use-case description. I have confirmed its usage with `--help`, and it takes no flags.
2. Deploy a second receiver with the KeystoneForwarder, `allowAnyWorkflow = false`, then fund it as in B.
3. `cre workflow deploy claim-workflow --target staging-settings` (registry `private`, so no wallet or gas is involved for the workflow itself).
4. Take the printed workflow ID and owner, call `setExpectedWorkflowId` and `setExpectedWorkflowOwner` on the receiver (it rejects every report until one is set).
5. Run `bun run cre:relay` with your authorized key so the app can trigger the deployed workflow.

I will show the exact command and ask again immediately before each of: contract deployment, funding, broadcast simulation, workflow deploy, and activation.
