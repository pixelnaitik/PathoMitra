import crypto from 'node:crypto';
import type { JsonWebKey as NodeJsonWebKey } from 'node:crypto';
import { getSecret, setSecret } from './keyring';

const PRIVATE_ACCOUNT = 'report-signing-private-v2';
const REGISTRY_ACCOUNT = 'report-signing-registry-v2';

type Registry = Record<string, JsonWebKey>;

function parseRegistry(raw: string | null): Registry {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Registry;
  } catch {
    return {};
  }
}

async function ensureKey(): Promise<{ privatePem: string; publicKey: JsonWebKey; keyId: string }> {
  let privatePem = await getSecret(PRIVATE_ACCOUNT);
  if (!privatePem) {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await setSecret(PRIVATE_ACCOUNT, privatePem);
  }
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  const der = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const keyId = crypto.createHash('sha256').update(der).digest('base64url');
  const registry = parseRegistry(await getSecret(REGISTRY_ACCOUNT));
  if (!registry[keyId]) {
    registry[keyId] = publicKey;
    await setSecret(REGISTRY_ACCOUNT, JSON.stringify(registry));
  }
  return { privatePem, publicKey, keyId };
}

export async function desktopReportPublicKey(): Promise<{ publicKey: JsonWebKey; keyId: string }> {
  const key = await ensureKey();
  return { publicKey: key.publicKey, keyId: key.keyId };
}

export async function signDesktopReport(
  manifest: string,
): Promise<{ signature: string; signedAt: string }> {
  const key = await ensureKey();
  const signature = crypto.sign('sha256', Buffer.from(manifest, 'utf8'), {
    key: key.privatePem,
    dsaEncoding: 'ieee-p1363',
  });
  return { signature: signature.toString('base64url'), signedAt: new Date().toISOString() };
}

export async function verifyDesktopReport(
  manifest: string,
  signature: string,
  keyId?: string,
): Promise<{ valid: boolean }> {
  const current = await ensureKey();
  const id = keyId || current.keyId;
  const registry = parseRegistry(await getSecret(REGISTRY_ACCOUNT));
  const publicKey = registry[id];
  if (!publicKey) return { valid: false };
  try {
    const verifier = crypto.createPublicKey({ key: publicKey as NodeJsonWebKey, format: 'jwk' });
    return {
      valid: crypto.verify(
        'sha256',
        Buffer.from(manifest, 'utf8'),
        { key: verifier, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    };
  } catch {
    return { valid: false };
  }
}
