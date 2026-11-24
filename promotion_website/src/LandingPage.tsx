import Header from './components/Header';
import Hero from './components/Hero';
import Download from './components/Download';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Trust from './components/Trust';
import CTA from './components/CTA';
import Footer from './components/Footer';
import { PageTransition } from './components/ui/motion';

/**
 * Each section owns its own scroll-reveal choreography (ui/motion.tsx), so the
 * page shell only sequences the route transition — no wrapper Reveals here.
 */
export default function LandingPage() {
  return (
    <PageTransition>
      <div className="min-h-dvh bg-background font-sans text-on-surface selection:bg-accent/20">
        <Header />
        <main id="main-content">
          <Hero />
          <Download />
          <Features />
          <HowItWorks />
          <Trust />
          <CTA />
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
}
