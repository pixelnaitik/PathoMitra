import { motion } from 'motion/react';
import { UserPlus, ClipboardList, FileCheck2, type LucideIcon } from 'lucide-react';
import { Eyebrow } from './ui/motion';

const steps: {
  number: string;
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    number: '01',
    title: 'Register the Patient',
    description:
      'Capture patient details, referral doctor and the tests ordered. Records go straight into the on-device database — encrypted at rest in the Android and Windows apps.',
    icon: UserPlus,
  },
  {
    number: '02',
    title: 'Enter Findings',
    description:
      'Type results against a curated pathology catalogue with units and reference ranges, with calculated indices like the CBC ratios filling in as you go.',
    icon: ClipboardList,
  },
  {
    number: '03',
    title: 'Issue the Report',
    description:
      'Check the live A4 layout, then print, save or share the PDF. It carries your name and the issue time; amending a final report raises its version and records your reason.',
    icon: FileCheck2,
  },
];

export default function HowItWorks() {
  return (
    <section id="how" className="py-24 px-6 bg-surface-container-lowest overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <Eyebrow center>How it works</Eyebrow>
          <h2 className="mt-3 text-3xl md:text-4xl font-bold tracking-[-0.03em] text-on-surface mb-4">
            3 Steps From Reception to Issued Report
          </h2>
          <p className="text-on-surface-variant">
            Built for the day-to-day bench workflow, and it keeps running when the lab loses its
            connection.
          </p>
        </div>

        <div className="relative flex flex-col md:flex-row justify-between items-start gap-12">
          {/* Connector Line (Desktop) — draws itself as the section enters */}
          <motion.div
            className="hidden md:block absolute top-10 left-0 w-full h-[2px] bg-surface-container-low z-0 origin-left"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            viewport={{ once: true }}
          />

          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: index * 0.16, ease: [0.22, 1, 0.36, 1] }}
              viewport={{ once: true, amount: 0.4 }}
              className="flex-1 text-center relative z-10 group"
            >
              {/* Numbered tile: fills with the brand on hover, icon rides along */}
              <motion.div
                whileHover={{ y: -4 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="relative mx-auto mb-8 flex h-20 w-20 items-center justify-center"
              >
                {/* halo ring that blooms in on hover */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-2xl bg-primary/0 ring-2 ring-primary/0 transition-all duration-300 group-hover:bg-primary/8 group-hover:ring-primary/25"
                />
                <div className="relative flex h-16 w-16 flex-col items-center justify-center rounded-2xl border-2 border-primary-container bg-surface-container-lowest font-black text-primary-container shadow-card transition-all duration-300 group-hover:scale-105 group-hover:bg-primary-container group-hover:text-on-primary-container">
                  <span className="text-xl leading-none">{step.number}</span>
                  <step.icon
                    className="mt-1 h-4 w-4 opacity-60 transition-opacity duration-300 group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </div>
              </motion.div>
              <h4 className="text-xl font-bold text-on-surface mb-3">{step.title}</h4>
              <p className="text-sm text-on-surface-variant px-4 leading-relaxed">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
