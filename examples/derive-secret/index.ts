import '@phala/pink-env'
import { encodeAbiParameters, decodeAbiParameters } from 'viem'

type Hex = `0x${string}`

export default function main(payload: Hex) {
  const [requestId, seed] = decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes' }],
    payload
  )
  const secret = pink.deriveSecret(seed)

  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'string' }],
    [
      requestId,
      secret.toString()
    ]
  )
}
