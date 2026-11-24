import { Link } from 'react-router-dom';
import { ArrowUp, Github, Mail } from 'lucide-react';
import { GITHUB_URL } from '../lib/contact';

const SUPPORT_EMAIL = 'pathomitra@healthcarediagnosticscenter.in';

const PRODUCT_LINKS = [
  { label: 'Technology', to: '/technology' },
  { label: 'Solutions', to: '/solutions' },
];

const RESOURCE_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Download', to: '/download' },
  { label: 'Privacy Policy', to: '/privacy' },
];

/*
 * Only a monitored support route is published. The advisory and press desks were
 * removed (owner decision 2026-10-16): the project answers support mail, nothing
 * else — inventing advisory/press channels is the kind of unstaffed contact claim
 * that stores and labs read as false. The phrasings are banned by
 * src/lib/marketing-claims.test.ts in the parent app, which reads this file too;
 * they are named here in a block comment because that is what the guard strips.
 */
const SUPPORT_LINKS = [{ label: 'Contact Support', subject: 'Support Request' }];

export default function Footer() {
  return (
    <footer className="bg-surface-container-low border-t border-outline-variant/30">
      <div className="max-w-7xl mx-auto px-4 md:px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-1">
            <span className="font-black text-primary text-xl block mb-1 tracking-tighter">
              PathoMitra
            </span>
            <span className="block text-[10px] font-bold tracking-wider uppercase text-on-surface-variant mb-6">
              LAB MANAGEMENT SIMPLIFIED
            </span>
            <p className="text-sm text-on-surface-variant mb-6 leading-relaxed">
              Offline laboratory management for clinical laboratories — patient records, reports,
              billing and analytics kept on the lab’s own machine.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="card-hover inline-flex items-center gap-2 rounded-full border border-outline-variant/10 bg-surface-container-lowest px-4 py-2 text-xs font-semibold text-on-surface-variant shadow-card hover:text-primary"
            >
              <Mail className="w-4 h-4" aria-hidden="true" />
              {SUPPORT_EMAIL}
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="card-hover mt-3 inline-flex items-center gap-2 rounded-full border border-outline-variant/10 bg-surface-container-lowest px-4 py-2 text-xs font-semibold text-on-surface-variant shadow-card hover:text-primary"
            >
              <Github className="w-4 h-4" aria-hidden="true" />
              Open source · MIT License
            </a>
          </div>

          <div>
            <h4 className="font-bold text-primary mb-6">Product</h4>
            <ul className="space-y-4 text-xs text-on-surface-variant">
              {PRODUCT_LINKS.map(link => (
                <li key={link.to}>
                  <Link
                    className="hover:text-primary transition-colors hover:underline"
                    to={link.to}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-primary mb-6">Resources</h4>
            <ul className="space-y-4 text-xs text-on-surface-variant">
              {RESOURCE_LINKS.map(link => (
                <li key={link.label}>
                  <Link
                    className="hover:text-primary transition-colors hover:underline"
                    to={link.to}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  className="hover:text-primary transition-colors hover:underline"
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub repository
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-primary mb-6">Support</h4>
            <ul className="space-y-4 text-xs text-on-surface-variant">
              {SUPPORT_LINKS.map(link => (
                <li key={link.label}>
                  <a
                    className="hover:text-primary transition-colors hover:underline"
                    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(link.subject)}`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Medical & legal disclaimer — the "not our fault, stated honestly"
            band the stores' medical-app reviewers look for: data provenance,
            who is responsible for clinical content, and no-outcome-warranty. */}
        <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 md:p-8 mb-10">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant mb-3">
            Medical &amp; Legal Disclaimer
          </h4>
          <p className="text-xs leading-relaxed text-on-surface-variant">
            PathoMitra is a records, reporting and billing tool for laboratory professionals. It is
            not a diagnostic device and provides no clinical decision support. Reference ranges,
            test metadata and default panels are compiled from publicly available standard sources
            and ship as editable defaults — every laboratory must review and adapt them to its own
            methods, instruments and protocols before use on patient reports. Reports are generated
            solely from data entered by the laboratory; validation, interpretation and delivery to
            patients remain the laboratory’s responsibility, and no warranty of clinical outcome is
            made or implied. Any accreditation a report carries belongs to the laboratory that
            enters it, not to this software.
          </p>
        </div>

        <div className="border-t border-outline-variant/30 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <span className="text-xs text-on-surface-variant opacity-70">
            © 2026 PathoMitra · Lab Management Simplified. Open source under the MIT License.
          </span>
          <div className="flex items-center gap-4">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-on-surface-variant font-medium transition-all hover:text-primary hover:underline"
            >
              GitHub
            </a>
            <Link
              className="text-xs text-on-surface-variant font-medium transition-all hover:text-primary hover:underline"
              to="/privacy"
            >
              Privacy Policy
            </Link>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="group inline-flex items-center gap-1 text-xs text-on-surface-variant font-medium transition-all hover:text-primary hover:underline"
            >
              Back to top
              <ArrowUp
                className="h-3 w-3 transition-transform duration-200 group-hover:-translate-y-0.5"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
