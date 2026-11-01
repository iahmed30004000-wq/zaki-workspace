export class DumpCounter {
  tables: number;
  rows: number;
  line(text: string): void;
  result(): { ok: boolean; tables: number; rows: number; error: string | null };
}
export function verifyBackupStream(source: AsyncIterable<Uint8Array>, masterKey: string): Promise<{ ok: boolean; tables: number; rows: number; error: string | null }>;
