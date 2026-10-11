/**
 * Windows Credential Manager access — the desktop counterpart of the
 * Android Keystore-backed `@aparajita/capacitor-secure-storage`.
 *
 * Holds the database encryption key. It is deliberately NOT stored in the
 * SQLite file, in localStorage, or derived from the operator passcode: DPAPI
 * seals it to the Windows user account, so a different user on the same PC
 * cannot read it. (Weaker than the phone's hardware KeyMint — this asymmetry
 * is documented in SECURITY.md rather than papered over.)
 *
 * `@napi-rs/keyring` is an ESM/CJS package resolved from node_modules at
 * runtime; createRequire keeps it working through the esbuild CJS bundle.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PasswordManager } = require('@napi-rs/keyring');

/** One namespace so unrelated credentials in the manager are never touched. */
const SERVICE = 'PathoMitra';

type PasswordManagerCtor = new (
  service: string,
  username: string,
  password: string,
) => {
  save: () => Promise<void>;
  deletePassword: () => Promise<boolean>;
  getPassword: () => Promise<string | null>;
};

const Pm = PasswordManager as PasswordManagerCtor;

export async function setSecret(account: string, secret: string): Promise<void> {
  await new Pm(SERVICE, account, secret).save();
}

export async function getSecret(account: string): Promise<string | null> {
  return (await new Pm(SERVICE, account, '').getPassword()) ?? null;
}

export async function deleteSecret(account: string): Promise<boolean> {
  return new Pm(SERVICE, account, '').deletePassword();
}
