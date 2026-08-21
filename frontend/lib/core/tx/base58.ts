/**
 * Base58 in the Bitcoin alphabet, which is the one Solana addresses use.
 *
 * Hand written rather than pulled in, because the only thing this package needs an
 * address library for is turning a 32 byte key into a string and back, and a
 * dependency that reaches the bot as well is a dependency to be sure about.
 *
 * The digit loop is the textbook one: base58 is not a power of two, so there is no
 * bit slicing shortcut and every byte of leading zero has to be carried across
 * explicitly as a leading '1'.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const INDEX = new Map<string, number>(
  Array.from(ALPHABET, (character, position) => [character, position]),
);

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Starts empty rather than at [0], so an all-zero key produces no digits at all
  // and is written purely as leading '1's. Seeding it with a zero appends a
  // thirty third character to the system program's address.
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let output = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    output += ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) output += ALPHABET[digits[i]];
  return output;
}

export function decodeBase58(text: string): Uint8Array {
  if (text.length === 0) return new Uint8Array();

  const bytes: number[] = [];
  for (const character of text) {
    const value = INDEX.get(character);
    if (value === undefined) {
      throw new Error(`not base58: ${character}`);
    }

    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeros = 0;
  for (const character of text) {
    if (character !== ALPHABET[0]) break;
    leadingZeros++;
  }

  return new Uint8Array([...new Array<number>(leadingZeros).fill(0), ...bytes.reverse()]);
}

/** A public key is 32 bytes. Anything else is a typo, and typos here move money. */
export function decodePublicKey(address: string): Uint8Array {
  const bytes = decodeBase58(address);
  if (bytes.length !== 32) {
    throw new Error(`a public key is 32 bytes, this decoded to ${bytes.length}`);
  }
  return bytes;
}

export function isValidPublicKey(address: string): boolean {
  try {
    decodePublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/** "7xKX…gAsU". For addresses in a table, where the middle carries no information. */
export function shortenAddress(address: string, edge = 4): string {
  if (address.length <= edge * 2 + 1) return address;
  return `${address.slice(0, edge)}…${address.slice(-edge)}`;
}
