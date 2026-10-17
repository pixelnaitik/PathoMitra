import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Download } from 'lucide-react';
import { Button } from './ui';
import { mailto } from '../lib/contact';

/**
 * CTA band — the conversion close of the landing page. The fill gets two slow
 * drifting glows behind the text (same aurora language as the hero), and the
 * primary action now points at a real place: /download, with the mailto
 * walkthrough kept as the secondary.
 */
export default function CTA() {
  return (
    <section className="py-24 px-6">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-5xl mx-auto bg-primary text-on-primary rounded-[3rem] p-12 md:p-20 text-center relative overflow-hidden shadow-float"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary-container to-primary opacity-50" />
        {/* drifting glows — the hero's aurora, inverted onto the brand fill */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="aurora-orb absolute -top-24 -left-16 h-72 w-72 rounded-full bg-on-primary/10 blur-[90px]" />
          <div className="aurora-orb absolute -bottom-28 -right-12 h-80 w-80 rounded-full bg-on-primary/10 blur-[100px]" />
        </div>
        <div className="relative z-10">
          <h2 className="text-4xl md:text-5xl font-bold mb-8 leading-tight tracking-[-0.03em]">
            Run PathoMitra on Your Own Bench
          </h2>
          <p className="text-xl md:text-2xl opacity-80 mb-12 max-w-2xl mx-auto font-medium">
            Built for small and mid-size labs: the same console the Android and Windows apps run,
            on the machine you work at — no server to buy, no subscription to renew, and a network
            cut never stops the bench.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/download">
              <Button
                variant="brand"
                size="lg"
                shine
                className="h-auto rounded-full bg-surface-container-lowest px-10 py-5 text-primary shadow-raised hover:bg-surface hover:shadow-float"
              >
                <Download className="h-4 w-4 icon-pop" aria-hidden="true" />
                Download
              </Button>
            </Link>
            <a href={mailto('Request a PathoMitra walkthrough')}>
              <Button
                variant="ghost"
                size="lg"
                className="h-auto rounded-full border border-on-primary/30 px-10 py-5 text-on-primary hover:bg-on-primary/10"
              >
                Talk to us
                <ArrowRight className="h-4 w-4 icon-slide" aria-hidden="true" />
              </Button>
            </a>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
