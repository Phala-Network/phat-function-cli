import { encodeAbiParameters, decodeAbiParameters } from 'viem'

export default function main() {
  const encodedData = encodeAbiParameters(
    [
      { name: 'x', type: 'string' },
      { name: 'y', type: 'uint' },
      { name: 'z', type: 'bool' }
    ],
    ['wagmi', 420n, true]
  )

  const values = decodeAbiParameters(
    [
      { name: 'x', type: 'string' },
      { name: 'y', type: 'uint' },
      { name: 'z', type: 'bool' }
    ],
    encodedData,
  )

  return values[0]
}
