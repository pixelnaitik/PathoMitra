package com.pathomitra.app;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;


import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;

/** Non-exportable Android Keystore signing for issued report manifests. */
@CapacitorPlugin(name = "ReportSigning")
public class ReportSigningPlugin extends Plugin {
    private static final String ALIAS = "pathomitra-report-signing-v2";

    private PrivateKey privateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY
            )
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false)
                .build();
            java.security.KeyPairGenerator generator = java.security.KeyPairGenerator.getInstance("EC", "AndroidKeyStore");
            generator.initialize(spec);
            generator.generateKeyPair();
        }
        return (PrivateKey) store.getKey(ALIAS, null);
    }

    private ECPublicKey publicKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return (ECPublicKey) store.getCertificate(ALIAS).getPublicKey();
    }

    private static String b64(byte[] value) {
        return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static byte[] unsigned32(java.math.BigInteger value) {
        byte[] raw = value.toByteArray();
        byte[] out = new byte[32];
        int length = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - length, out, 32 - length, length);
        return out;
    }

    private static byte[] derToRaw(byte[] der) throws Exception {
        int index = 1;
        if (der[0] != 0x30) throw new Exception("Invalid ECDSA signature");
        int sequenceLength = der[index++] & 0xff;
        if ((sequenceLength & 0x80) != 0) index += sequenceLength & 0x7f;
        if (der[index++] != 0x02) throw new Exception("Invalid ECDSA r");
        int rLength = der[index++] & 0xff;
        if ((rLength & 0x80) != 0) index += rLength & 0x7f;
        byte[] r = new byte[rLength];
        System.arraycopy(der, index, r, 0, rLength);
        index += rLength;
        if (der[index++] != 0x02) throw new Exception("Invalid ECDSA s");
        int sLength = der[index++] & 0xff;
        if ((sLength & 0x80) != 0) index += sLength & 0x7f;
        byte[] s = new byte[sLength];
        System.arraycopy(der, index, s, 0, sLength);
        byte[] out = new byte[64];
        byte[] rr = unsigned32(new java.math.BigInteger(r));
        byte[] ss = unsigned32(new java.math.BigInteger(s));
        System.arraycopy(rr, 0, out, 0, 32);
        System.arraycopy(ss, 0, out, 32, 32);
        return out;
    }

    private static byte[] rawToDer(byte[] raw) {
        byte[] r = new java.math.BigInteger(1, java.util.Arrays.copyOfRange(raw, 0, 32)).toByteArray();
        byte[] s = new java.math.BigInteger(1, java.util.Arrays.copyOfRange(raw, 32, 64)).toByteArray();
        int length = 2 + r.length + 2 + s.length;
        byte[] der = new byte[2 + length];
        int index = 0;
        der[index++] = 0x30;
        der[index++] = (byte) length;
        der[index++] = 0x02;
        der[index++] = (byte) r.length;
        System.arraycopy(r, 0, der, index, r.length);
        index += r.length;
        der[index++] = 0x02;
        der[index++] = (byte) s.length;
        System.arraycopy(s, 0, der, index, s.length);
        return der;
    }

    private JSObject publicKeyJson() throws Exception {
        privateKey();
        ECPublicKey key = publicKey();
        JSObject jwk = new JSObject();
        jwk.put("kty", "EC");
        jwk.put("crv", "P-256");
        jwk.put("x", b64(unsigned32(key.getW().getAffineX())));
        jwk.put("y", b64(unsigned32(key.getW().getAffineY())));
        jwk.put("ext", true);
        String keyId = b64(MessageDigest.getInstance("SHA-256").digest(key.getEncoded()));
        JSObject result = new JSObject();
        result.put("publicKey", jwk);
        result.put("keyId", keyId);
        return result;
    }

    @PluginMethod
    public void publicKey(PluginCall call) {
        try { call.resolve(publicKeyJson()); } catch (Exception error) { call.reject("Could not initialize report signing key", error); }
    }

    @PluginMethod
    public void sign(PluginCall call) {
        String manifest = call.getString("manifest");
        if (manifest == null || manifest.isEmpty()) { call.reject("A report manifest is required"); return; }
        try {
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(privateKey());
            signer.update(manifest.getBytes(StandardCharsets.UTF_8));
            JSObject result = new JSObject();
            result.put("signature", b64(derToRaw(signer.sign())));
            result.put("signedAt", java.time.Instant.now().toString());
            call.resolve(result);
        } catch (Exception error) { call.reject("Report signing failed", error); }
    }

    @PluginMethod
    public void verify(PluginCall call) {
        String manifest = call.getString("manifest");
        String encoded = call.getString("signature");
        String keyId = call.getString("keyId");
        if (manifest == null || encoded == null) { call.reject("Manifest and signature are required"); return; }
        try {
            String currentKeyId = publicKeyJson().getString("keyId");
            if (keyId != null && !keyId.equals(currentKeyId)) { call.resolve(new JSObject().put("valid", false)); return; }
            byte[] raw = Base64.decode(encoded, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(publicKey());
            verifier.update(manifest.getBytes(StandardCharsets.UTF_8));
            call.resolve(new JSObject().put("valid", verifier.verify(rawToDer(raw))));
        } catch (Exception error) { call.reject("Report signature verification failed", error); }
    }
}
