import { Link } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { motion } from 'motion/react';
import { Smartphone, Activity, Sparkles, Server } from 'lucide-react';
import { Button } from '../components/ui';
import { Eyebrow, PageTransition, Reveal } from '../components/ui/motion';
import { mailto } from '../lib/contact';

/** Bullet rail: each fact slides in on a small stagger when the card reveals. */
function BulletList({ items, dotClass, textClass }: { items: string[]; dotClass: string; textClass: string }) {
  return (
    <ul className="space-y-3 mb-8">
      {items.map((item, i) => (
        <motion.li
          key={item}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ delay: 0.15 + i * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className={`flex items-center gap-3 text-sm font-medium ${textClass}`}
        >
          <div className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {item}
        </motion.li>
      ))}
    </ul>
  );
}

export default function SolutionsPage() {
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
                <Eyebrow center>Solutions</Eyebrow>
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.05 }}
                className="mt-3 text-4xl md:text-6xl font-bold text-on-surface tracking-[-0.03em] mb-6"
              >
                A Seamless Technology Platform for Your Lab
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.15 }}
                className="text-lg text-on-surface-variant font-medium"
              >
                PathoMitra provides modern, fast, and secure tools designed specifically for
                pathologists and clinical laboratories to manage patient records, reports and
                analytics on the laboratory’s own machine.
              </motion.p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mb-24">
              {/* Solution 1 */}
              <Reveal y={24}>
                <div className="card-hover spotlight relative h-full overflow-hidden bg-surface-container-lowest p-10 rounded-3xl border border-outline-variant/30 shadow-card group hover:border-primary-container/50">
                  <div className="absolute top-0 right-0 p-8 opacity-5 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3">
                    <Server className="w-32 h-32" />
                  </div>
                  <div className="relative z-10">
                    <div className="w-14 h-14 bg-surface-container rounded-2xl flex items-center justify-center mb-6 transition-colors duration-300 group-hover:bg-primary/10">
                      <Activity className="w-7 h-7 text-primary transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110" />
                    </div>
                    <h3 className="text-2xl font-bold text-on-surface mb-4">
                      Streamlined Lab Operations
                    </h3>
                    <p className="text-on-surface-variant mb-6 leading-relaxed">
                      Streamline your day-to-day operations with an easy-to-use interface. Manage
                      patient registrations, generate instant reports, and manage operations without
                      needing in-house IT staff.
                    </p>
                    <BulletList
                      textClass="text-on-surface-variant"
                      dotClass="bg-secondary"
                      items={[
                        'No server to buy, install or maintain',
                        'Encrypted on-device records on Android and Windows',
                        'Lightning-fast data entry',
                        'PIN lock everywhere, biometric unlock on Android',
                      ]}
                    />
                  </div>
                </div>
              </Reveal>

              {/* Solution 2 */}
              <Reveal y={24} delay={0.1}>
                <div className="relative h-full overflow-hidden bg-primary text-on-primary p-10 rounded-3xl shadow-raised transition-shadow duration-300 hover:shadow-float group">
                  <div className="absolute top-0 right-0 p-8 opacity-10 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3">
                    <Smartphone className="w-32 h-32 text-on-primary" />
                  </div>
                  <div className="relative z-10">
                    <div className="w-14 h-14 bg-surface-container-lowest/10 rounded-2xl flex items-center justify-center mb-6 transition-colors duration-300 group-hover:bg-surface-container-lowest/20">
                      <Sparkles className="w-7 h-7 text-on-primary transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110" />
                    </div>
                    <h3 className="text-2xl font-bold text-on-primary mb-4">
                      Modern Patient Experience
                    </h3>
                    <p className="text-on-primary/80 mb-6 leading-relaxed">
                      Hand over a report that reads as well as it prints. Every PDF carries the name
                      of the operator who issued it and the time it was issued, and you decide how it
                      reaches the patient.
                    </p>
                    <BulletList
                      textClass="text-on-primary/90"
                      dotClass="bg-secondary-container"
                      items={[
                        'Print, save or share the PDF via the Android share sheet',
                        'Operator name and issue time printed on each report',
                        'Clean, modern PDF report designs',
                        'Referring-doctor details captured with every patient',
                      ]}
                    />
                  </div>
                </div>
              </Reveal>
            </div>

            {/* CTA embedded */}
            <Reveal y={28}>
              <div className="bg-surface-container-low rounded-3xl p-12 text-center border border-outline-variant/30">
                <h2 className="text-3xl font-bold tracking-[-0.03em] text-on-surface mb-4">
                  Ready to explore PathoMitra?
                </h2>
                <p className="text-on-surface-variant mb-8 max-w-2xl mx-auto">
                  Open the same patient, report and analytics console that runs on the bench — free to
                  use, with no ads, no subscription and no per-report fees. The first account you create
                  is the only one, everything is stored locally, and the app sends nothing to a server.
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <Link to="/download">
                    <Button variant="brand" size="lg" shine>
                      Download
                    </Button>
                  </Link>
                  <a href={mailto('Request a PathoMitra walkthrough')}>
                    <Button
                      variant="outline"
                      size="lg"
                      className="px-8 py-6 text-lg"
                    >
                      Talk to us
                    </Button>
                  </a>
                </div>
              </div>
            </Reveal>
          </div>
        </main>
      </PageTransition>
      <Footer />
    </div>
  );
}
