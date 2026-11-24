import { eraseAppOutputs } from './native-files';
import { clearCrashLog } from './crash-log';
import { resetPriceListCache } from './price-list';
import { clearReportSigningKey } from './report-signing';
import { clearBiometricCredentials } from './biometric';

/** Remove non-database copies after the authoritative clinical store is erased. */
export async function eraseLocalArtifacts(): Promise<void> {
  await eraseAppOutputs();
  await clearCrashLog();
  await clearBiometricCredentials();
  await clearReportSigningKey();
  resetPriceListCache();
  const prefixes = [
    'pathologyos_',
    'custom_pathology_tests',
    'pathlab_',
    'pathlab:',
    'pathomitra-web-demo',
  ];
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key && prefixes.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key);
  }
}
