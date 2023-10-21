import {
  WalkerImpl,
  createTupleEncoder,
  encodeStr,
  decodeStr,
  encodeU8,
  decodeU8,
  createVecEncoder,
  createVecDecoder,
  createTupleDecoder,
} from '@scale-codec/core'

type Tuple = [string, string, string, string, number[]]

const encodeS3Put = createTupleEncoder<Tuple>([
  encodeStr,
  encodeStr,
  encodeStr,
  encodeStr,
  createVecEncoder(encodeU8),
])

const decodeS3Put = createTupleDecoder<Tuple>([
  decodeStr,
  decodeStr,
  decodeStr,
  decodeStr,
  createVecDecoder(decodeU8),
])

const endpoint = 'endpoint'
const region = 'region'
const bucket = 'bucket'
const object_key = 'object_key'
const value = new Uint8Array(32)

export default function main() {
  const bytes = WalkerImpl.encode([
    endpoint,
    region,
    bucket,
    object_key,
    Array.from(value),
  ], encodeS3Put)
  const decoded = WalkerImpl.decode(bytes, decodeS3Put)
  console.info(decoded)
  return bytes
}
