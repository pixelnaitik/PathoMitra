import Header from '../components/Header';
import Footer from '../components/Footer';
import { motion } from 'motion/react';
import { Zap, WifiOff, Fingerprint, Lock, Github } from 'lucide-react';
import { Eyebrow, PageTransition, Reveal } from '../components/ui/motion';

export default function TechnologyPage() {
  return (
    <div className="min-h-dvh bg-background selection:bg-secondary-container selection:text-on-secondary-container">
      <PageTransition>
        <Header />
        <main id="main-content" className="pt-24 pb-16">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <Eyebrow center>Technology</Eyebrow>
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.05 }}
                className="mt-3 text-4xl md:text-6xl font-bold text-on-surface tracking-[-0.03em] mb-6"
              >
                Built for Trust, Speed, and Precision
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.15 }}
                className="text-lg text-on-surface-variant font-medium"
              >
                PathoMitra is a local-first laboratory console for Android, Windows and the browser:
                the records, the encryption and the controls all live on the machine doing the work.
              </motion.p>
            </div>

            {/* Benefits Grid */}
            <div className="mb-16">
              <Reveal>
                <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-accent text-center mb-3">
                  Why PathoMitra
                </span>
                <h2 className="text-3xl font-bold tracking-[-0.03em] text-on-surface mb-12 text-center">
                  The PathoMitra Advantage
                </h2>
              </Reveal>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  icon: WifiOff,
                  title: 'Offline by Design',
                  desc: 'The Android build does not request the INTERNET permission, so patient data has no pathway off the device. The Windows desktop build works the same way on your bench PC — no server, no sync, and the lab keeps working through outages and dead connections.',
                },
                {
                  icon: Lock,
                  title: 'Encrypted on the Device',
                  desc: 'In the Android app, records sit in a SQLCipher (AES-256) database whose key is held in the hardware keystore, never in the app bundle or plain preferences. The Windows build stores the same AES-256 encrypted database with its key in the Windows Credential Locker (DPAPI). The browser build runs the same console on unencrypted local storage.',
                },
                {
                  icon: Zap,
                  title: 'Built for Bench Speed',
                  desc: 'Keyboard-first data entry, command search, progressively-paged lists and an undo history — designed around typing hundreds of results a day.',
                },
                {
                  icon: Fingerprint,
                  title: 'Device-Bound Unlock',
                  desc: 'A PBKDF2-hashed PIN everywhere, plus an optional biometric or screen-lock credential on Android, verified by the operating system rather than by this app.',
                },
                {
                  icon: Github,
                  title: 'Open Source (MIT)',
                  desc: 'The whole console — Android, Windows and browser — is published under the MIT license at github.com/pixelnaitik/PathoMitra. Read the code, or have your IT partner audit it before it ever touches patient data.',
                },
              ].map((benefit, i) => (
                <Reveal key={i} delay={i * 0.07} y={22}>
                  <div className="card-hover spotlight group h-full bg-surface-container-lowest p-8 rounded-3xl border border-outline-variant/30 shadow-card">
                    <div className="w-12 h-12 bg-surface-container rounded-xl flex items-center justify-center mb-6 transition-colors duration-300 group-hover:bg-primary/10">
                      <benefit.icon className="w-6 h-6 text-primary-container transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110 group-hover:-rotate-6" />
                    </div>
                    <h3 className="text-xl font-bold text-on-surface mb-3">{benefit.title}</h3>
                    <p className="text-on-surface-variant text-sm leading-relaxed">{benefit.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
            </div>
          </div>
        </main>
      </PageTransition>
      <Footer />
    </div>
  );
}
