import { Capacitor, registerPlugin } from '@capacitor/core';
import { desktopBridge } from './desktop-bridge';

export interface BackupDestinationResult {
  id: string;
  label: string;
}

export interface BackupCopyResult {
  fileName: string;
  verified: boolean;
}

export interface NativeBackupDestination {
  chooseDestination(): Promise<BackupDestinationResult | null>;
  status(): Promise<BackupDestinationResult | null>;
  copy(args: { fileName: string; payload: string }): Promise<BackupCopyResult>;
}

const NativeBackup = registerPlugin<NativeBackupDestination>('BackupDestination');

export function backupDestinationProvider(): NativeBackupDestination | null {
  return Capacitor.isNativePlatform() ? NativeBackup : null;
}

export async function chooseBackupDestination(): Promise<BackupDestinationResult | null> {
  const desktop = desktopBridge()?.backupDestination;
  if (desktop) return desktop.choose();
  const native = backupDestinationProvider();
  return native ? native.chooseDestination() : null;
}

export async function backupDestinationStatus(): Promise<BackupDestinationResult | null> {
  const desktop = desktopBridge()?.backupDestination;
  if (desktop) return desktop.status();
  const native = backupDestinationProvider();
  return native ? native.status() : null;
}

export async function copyBackupToDestination(
  fileName: string,
  payload: string,
): Promise<BackupCopyResult> {
  const desktop = desktopBridge()?.backupDestination;
  if (desktop) return desktop.copy(fileName, payload);
  const native = backupDestinationProvider();
  if (!native)
    throw new Error(
      'Off-device backup destinations are available only in the Android or Desktop app.',
    );
  return native.copy({ fileName, payload });
}
