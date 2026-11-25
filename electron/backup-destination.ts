import { BrowserWindow, app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSecret, setSecret } from './keyring';

const ACCOUNT = 'backup-destination-v1';

function safeName(name: string): string {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(name) || name.includes('..'))
    throw new Error('Invalid backup filename.');
  return name;
}

export async function chooseBackupDestination(
  parent?: BrowserWindow | null,
): Promise<{ id: string; label: string } | null> {
  const result = parent
    ? await dialog.showOpenDialog(parent, {
        title: 'Choose encrypted backup destination',
        properties: ['openDirectory', 'createDirectory'],
      })
    : await dialog.showOpenDialog({
        title: 'Choose encrypted backup destination',
        properties: ['openDirectory', 'createDirectory'],
      });
  if (result.canceled || !result.filePaths[0]) return null;
  const destination = path.resolve(result.filePaths[0]);
  fs.mkdirSync(destination, { recursive: true });
  await setSecret(ACCOUNT, destination);
  return { id: destination, label: destination };
}

export async function backupDestinationStatus(): Promise<{ id: string; label: string } | null> {
  const destination = await getSecret(ACCOUNT);
  return destination ? { id: destination, label: destination } : null;
}

let schedulerRunning = false;

async function copyLatestLocalBackup(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const directory = path.join(app.getPath('userData'), 'PathoMitra', 'Backups');
    const files = fs.existsSync(directory)
      ? fs
          .readdirSync(directory, { withFileTypes: true })
          .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
          .map(entry => ({
            name: entry.name,
            time: fs.statSync(path.join(directory, entry.name)).mtimeMs,
          }))
          .sort((a, b) => b.time - a.time)
      : [];
    if (!files.length) return;
    const latest = files[0];
    const payload = fs.readFileSync(path.join(directory, latest.name), 'utf8');
    try {
      if (JSON.parse(payload).kind !== 'backup-encrypted') return;
    } catch {
      return;
    }
    await copyBackupToDestination(latest.name, payload);
  } catch (error) {
    console.error(
      'PathoMitra: scheduled off-device backup copy failed',
      error instanceof Error ? error.message : 'unknown error',
    );
  } finally {
    schedulerRunning = false;
  }
}

export function startBackupDestinationScheduler(): void {
  const run = () => {
    void copyLatestLocalBackup();
  };
  setTimeout(run, 60_000);
  setInterval(run, 24 * 60 * 60_000);
}

export async function copyBackupToDestination(
  fileName: string,
  payload: string,
): Promise<{ fileName: string; verified: boolean }> {
  const destination = await getSecret(ACCOUNT);
  if (!destination) throw new Error('Choose an off-device backup destination first.');
  const safe = safeName(fileName);
  let target = path.join(destination, safe);
  if (fs.existsSync(target)) target = path.join(destination, `${crypto.randomUUID()}-${safe}`);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
    if (fs.readFileSync(target, 'utf8') !== payload)
      throw new Error('Off-device backup read-back verification failed.');
    return { fileName: path.basename(target), verified: true };
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      /* preserve original failure */
    }
    throw error;
  }
}
