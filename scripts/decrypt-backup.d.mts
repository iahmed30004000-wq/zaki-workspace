export const MAGIC: string;
export const VERSION: number;
export const KEY_INFO: string;
export const HEADER_BYTES: number;
export class BackupCryptoError extends Error {
  constructor(code: string);
  code: "bad_magic" | "bad_version" | "truncated" | "auth";
}
export function decryptBackup(source: AsyncIterable<Uint8Array>, masterKey: string): AsyncGenerator<Buffer>;
