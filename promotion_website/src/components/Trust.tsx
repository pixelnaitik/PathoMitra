import { WifiOff, Lock, Activity, Scale } from 'lucide-react';
import { motion } from 'motion/react';
import { Eyebrow } from './ui/motion';

const guarantees = [
  // Descriptions of how the software is built — not certifications.
  // PathoMitra holds no HIPAA, SOC 2, CE IVD or GDPR attestation of its own, and
  // printing those marks here would be an unauthorised use of certification
  // imagery. Any accreditation a laboratory holds belongs to the laboratory, and
  // it states that on its own reports via Settings → Report footer credentials.
  //
  // Three of these are scoped to a specific build, not to the browser: the
  // INTERNET-permission guarantee and biometric unlock are Android properties
  // (`AndroidManifest.xml`, `lib/biometrics.ts` answers "only available in the
  // mobile app"). Encryption at rest covers both native builds — SQLCipher via
  // `Capacitor.isNativePlatform()` on Android (hardware keystore) and
  // `better-sqlite3-multiple-ciphers` on Windows (key in the Credential Locker /
  // DPAPI) — and the label says so, so a visitor reading this page in a browser
  // is not told their session is encrypted when it is not.
  { icon: WifiOff, label: 'No INTERNET permission (Android)' },
  { icon: Lock, label: 'SQLCipher at rest (Android + Windows)' },
  { icon: Activity, label: 'Biometric unlock (Android)' },
  { icon: Scale, label: 'Operator owns every record' },
];

export default function Trust() {
  return (
    <section className="py-20 bg-surface-container-low px-6 border-t border-outline-variant/20">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-12">
        <div className="max-w-md">
          <Eyebrow>Security model</Eyebrow>
          <h3 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-on-surface mb-2">
            The record never leaves the bench
          </h3>
          <p className="text-on-surface-variant leading-relaxed">
            PathoMitra runs as a fully offline laboratory console. The Android build does not
            request the INTERNET permission, so there is no pathway for patient data to be
            transmitted from the device; the Windows desktop build keeps the same encrypted local
            database on your bench PC and sends nothing to a server.
          </p>
          {/* The honest counterpart to the scoped labels above. The browser build is the
              same console on the same code path, but it persists through `WebRepository`
              (plain `localStorage`, no keystore, no encryption) and the browser can always
              reach the network. Saying so here is what makes the four chips above true. */}
          <p className="mt-4 text-sm text-on-surface-variant leading-relaxed">
            Use the Android app or the Windows desktop build (Windows 10/11, 64-bit) for clinical
            work — both keep records in an AES-256 encrypted database on the machine itself. The
            browser build is the same console on unencrypted local storage: records stay on that
            machine, but there is no database encryption, no biometric unlock and no offline
            guarantee, and nothing is ever uploaded.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 opacity-80">
          {guarantees.map(({ icon: Icon, label }, index) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1, type: 'spring', stiffness: 240, damping: 20 }}
              viewport={{ once: true }}
              whileHover={{ y: -4 }}
              className="group flex flex-col items-center"
            >
              <div className="card-hover w-16 h-16 bg-surface-container-lowest rounded-full flex items-center justify-center shadow-card border border-outline-variant/10 mb-3 transition-colors duration-300 group-hover:border-secondary/40">
                <Icon className="w-8 h-8 text-secondary transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110 group-hover:-rotate-6" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant text-center transition-colors duration-200 group-hover:text-on-surface">
                {label}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
