import { backupDriveSpace, deleteOnDrive, driveIdOf, readFromDrive, uploadToDrive } from "@/server/files/drive-store";
import { driveCanStore } from "@/server/services/google";

/**
 * Where a backup goes: the owner's Google Drive, through the store the library already uses (src/server/files/drive-store.ts),
 * in its own folder «نسخ احتياطي» beside the spaces' folders. This small interface is the only thing the backup service knows
 * about Drive, so a test can stand in a fake (override with `setBackupDriveForTests`).
 */
export interface BackupDrive {
  /** Connected, configured and allowed to write (the `drive.file` grant). False: the run is recorded as failed, nothing is written anywhere. */
  ready(orgId: string): Promise<boolean>;
  /** Uploads a file already on local disk (streamed, checked by size and MD5 on Drive) and returns Drive's id for it. */
  upload(orgId: string, input: { name: string; path: string; size: number; runId: string }): Promise<string>;
  remove(orgId: string, driveId: string): Promise<void>;
  open(orgId: string, driveId: string): Promise<AsyncIterable<Uint8Array>>;
}

export const googleBackupDrive: BackupDrive = {
  ready: (orgId) => driveCanStore(orgId),
  async upload(orgId, input) {
    const stored = await uploadToDrive(orgId, {
      name: input.name,
      mimeType: "application/octet-stream",
      space: backupDriveSpace(orgId),
      fileId: input.runId,
      path: input.path,
      size: input.size,
    });
    return driveIdOf(stored);
  },
  remove: (orgId, driveId) => deleteOnDrive(orgId, driveId),
  async open(orgId, driveId) {
    return readFromDrive(orgId, driveId, null) as unknown as AsyncIterable<Uint8Array>;
  },
};

let current: BackupDrive = googleBackupDrive;

export function backupDrive(): BackupDrive {
  return current;
}

/** Test hook: stand a fake Drive in (null puts the real one back). Never call from server code. */
export function setBackupDriveForTests(fake: BackupDrive | null): void {
  current = fake ?? googleBackupDrive;
}
