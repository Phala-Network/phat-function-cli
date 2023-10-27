import '@phala/pink-env'
import {
  WalkerImpl,
  encodeStr,
  decodeStr,
  createTupleEncoder,
  createResultDecoder,
  createEnumDecoder,
} from '@scale-codec/core'

type Tuple = [string]

const encodeInput = createTupleEncoder<Tuple>([
  encodeStr,
])

const decodeResult = createResultDecoder<string, any>(
  decodeStr,
  createEnumDecoder({
    0: 'InvalidEthAddress',
    1: 'HttpRequestFailed',
    2: 'InvalidResponseBody',
  })
)

const decodeInvokeResult = createResultDecoder<any, any>(
  decodeResult,
  decodeStr,
)

export default function main() {
  const bytes = WalkerImpl.encode([
    // query method args: ETH account address
    '0x8a4b4bd8c5e842eecb2681b99dc5c25b8eb11710',
  ], encodeInput)
  // Call PoC6 contract query method to query ETH account balance
  const contractOutput = pink.invokeContract({
    callee: '0x0391ecc95c76f7e22f394abf48233b5cb0c3c77996dd796dec0ae757281a468e',
    selector: 0x437a5ed1,
    input: bytes,
  })
  const decoded = WalkerImpl.decode(contractOutput, decodeInvokeResult)
  return JSON.stringify(decoded)
}
