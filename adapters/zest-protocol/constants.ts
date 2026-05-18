/**
 * Zest Protocol contract addresses + token identifiers.
 */

export const DEPLOYER = 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7'
export const OLD_CONTRACT = 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N'

export const SBTC_TOKEN_ID =
  'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token'

export const SBTC_DECIMALS = 8

/** All vault contracts that hold sBTC for Zest. */
export const VAULT_ADDRESSES = [
  `${OLD_CONTRACT}.pool-vault`, // v1
  `${DEPLOYER}.v0-vault-sbtc`, // v0
] as const
