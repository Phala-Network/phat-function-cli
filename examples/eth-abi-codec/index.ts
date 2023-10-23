import { Coders } from '@phala/ethers'

const uintCoder = new Coders.NumberCoder(32, false, 'uint256')
const stringCoder = new Coders.StringCoder('string')
const addressCoder = new Coders.AddressCoder('address')
const addressArrayCoder = new Coders.ArrayCoder(addressCoder, -1, 'address[]')

export default function main() {
  const encoded = Coders.encode(
    [uintCoder, stringCoder, addressArrayCoder],
    [0, '0', ['0x794e44D1334A56Fea7f4df12633b88820D0c5888']],
  )
  const decoded = Coders.decode(
    [uintCoder, stringCoder, addressArrayCoder],
    encoded,
  )
  console.info(decoded)
  return decoded[0]
}
