import { vrf } from '@phala/pink-env'
import { encodeAbiParameters, decodeAbiParameters } from 'viem'

type Hex = `0x${string}`

export default function main(payload: Hex) {
  const [requestId, seed, start, stop] = decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes' }, { type: 'uint8' }, { type: 'uint8' }],
    payload
  )
  const randomness = vrf(seed)
  let randomNum = randomness[0]
  let j = 0
  while (randomNum < stop && j++ < randomness.length) {
    randomNum = randomNum + (randomness[j] << 8 * j)
  }
  randomNum = randomNum % (stop - start) + start

  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [
      requestId,
      BigInt(randomNum)
    ]
  )
}
