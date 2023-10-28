import { vrf } from "@phala/pink-env";
import { encodeAbiParameters, decodeAbiParameters } from 'viem'

type Hex = `0x${string}`

/**
 * This function responses with requestId and the randomness result, which you
 * can implemented same same `fullfillRandomWords` as Chainlink VRF callback.
 */
export default function main(payload: Hex) {
  const [requestId, seed] = decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes' }],
    payload
  )
  const randomness = vrf(seed)
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256[]' }],
    [
      requestId,
      Array.from(randomness).map(i => BigInt(i))
    ]
  )
}
