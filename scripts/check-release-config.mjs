#!/usr/bin/env node
/**
 * Pre-submission config guard.
 *
 * Google Play will not accept an app that handles health data if its privacy
 * policy URL is not reachable, not the developer's own, or names a contact nobody
 * monitors. Until now the only reminder was a code comment in
 * `src/lib/privacy-policy.ts` telling the author to replace the placeholder — and
 * a comment that survives `npm run build` is a rejection that survives review.
 *
 * So this fails the native build outright when the release identity is still
 * unset or obviously fake. It reads the same `.env` that Vite loads, so what it
 * checks is what ends up in the bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

// `quiet` suppresses dotenv's own log line, which otherwise drops a promotional
// tip into the middle of the release build output.
dotenv.config({ quiet: true, path: path.resolve(process.cwd(), '.env') });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_HTTPS = /^https:\/\/[^\s]+$/;

/** Domains that are never a real answer, plus the placeholder suffixes. */
const BLOCKED_HOSTS = ['example.invalid', 'example.com', 'localhost', 'your-domain'];
const BLOCKED_URL_HOSTS = ['pages.dev', 'vercel.app', 'netlify.app', 'github.io'];

const problems = [];

function checkEmail(value, name) {
  if (!value) {
    problems.push(`${name} is not set. Add it to .env — Play needs a monitored privacy contact.`);
    return;
  }
  if (!EMAIL.test(value)) {
    problems.push(`${name}="${value}" is not a valid email address.`);
    return;
  }
  const host = value.split('@')[1].toLowerCase();
  if (BLOCKED_HOSTS.some(blocked => host.includes(blocked))) {
    problems.push(`${name}="${value}" is still a placeholder domain.`);
  }
}

function checkUrl(value, name) {
  if (!value) {
    problems.push(`${name} is not set. Play requires a publicly reachable policy URL.`);
    return;
  }
  if (!URL_HTTPS.test(value)) {
    problems.push(`${name}="${value}" must be an absolute https:// URL.`);
    return;
  }
  const host = new URL(value).hostname.toLowerCase();
  if (BLOCKED_HOSTS.some(blocked => host.includes(blocked))) {
    problems.push(`${name}="${value}" is still a placeholder domain.`);
  }
  // A free platform subdomain works today but can be taken away, and Play asks
  // that the policy live at a developer-controlled location.
  if (BLOCKED_URL_HOSTS.some(shared => host === shared || host.endsWith(`.${shared}`))) {
    problems.push(
      `${name}="${value}" points at a shared platform subdomain rather than a domain you own.`,
    );
  }
}

checkEmail(process.env.VITE_SUPPORT_EMAIL, 'VITE_SUPPORT_EMAIL');
checkUrl(process.env.VITE_PRIVACY_URL, 'VITE_PRIVACY_URL');

const envFile = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envFile)) {
  problems.push('.env does not exist — copy .env.example and fill in both values.');
}

if (problems.length > 0) {
  console.error('\n✗ Release configuration is incomplete.\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n  Set VITE_SUPPORT_EMAIL and VITE_PRIVACY_URL in .env, generate the hosted\n' +
      '  policy with `npm run build:privacy`, and host privacy-site/ on that domain.\n',
  );
  process.exit(1);
}

console.log(
  `✓ Release configuration OK — contact ${process.env.VITE_SUPPORT_EMAIL}, policy ${process.env.VITE_PRIVACY_URL}`,
);
