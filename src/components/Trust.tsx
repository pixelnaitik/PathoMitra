import { ShieldCheck, Lock, Activity, Scale } from 'lucide-react';
import { motion } from 'motion/react';

const guarantees = [
  // Descriptions of how the software is built — not certifications.
  // PathLab OS holds no HIPAA, SOC 2, CE IVD or GDPR attestation of its own, and
  // printing those marks here would be an unauthorised use of certification
  // imagery. Any accreditation a laboratory holds belongs to the laboratory, and
  // it states that on its own reports via Settings → Report footer credentials.
  { icon: Lock, label: 'No internet permission' },
  { icon: ShieldCheck, label: 'Encrypted at rest (SQLCipher)' },
  { icon: Activity, label: 'Biometric device unlock' },
  { icon: Scale, label: 'Operator owns every record' },
];

export default function Trust() {
  return (
    <section className="py-20 bg-surface-container-low px-6 border-t border-outline-variant/20">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-12">
        <div className="max-w-md">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">
            Security model
          </span>
          <h3 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-on-surface mb-2">
            The record never leaves the bench
          </h3>
          <p className="text-on-surface-variant leading-relaxed">
            PathLab OS runs as a fully offline laboratory console. The Android build does not
            request the INTERNET permission, so there is no pathway for patient data to be
            transmitted from the device.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 opacity-80">
          {guarantees.map(({ icon: Icon, label }, index) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              viewport={{ once: true }}
              className="flex flex-col items-center"
            >
              <div className="card-hover w-16 h-16 bg-surface-container-lowest rounded-full flex items-center justify-center shadow-card border border-outline-variant/10 mb-3">
                <Icon className="w-8 h-8 text-secondary" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant text-center">
                {label}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
