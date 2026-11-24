/**
 * Platform brand marks for the store badges. Hand-drawn inline SVG (lucide
 * ships no Android/Windows logos) — the geometry mirrors the reference badges:
 * the green Android robot head with antennae, and the flat four-pane Windows
 * flag. Both inherit sizing from the caller via className.
 */

export function AndroidRobotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      {/* antennae — round-capped strokes leaning outward */}
      <path
        d="M8.1 6.4 6.4 4.3M15.9 6.4l1.7-2.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* head: flat-bottom dome */}
      <path d="M5.4 11a6.6 6.6 0 0 1 13.2 0v5.6a1 1 0 0 1-1 1H6.4a1 1 0 0 1-1-1Z" />
      {/* eyes punch through to the badge plate colour */}
      <circle cx="9.3" cy="10.6" r="1" fill="var(--badge-plate, #0b0d10)" />
      <circle cx="14.7" cy="10.6" r="1" fill="var(--badge-plate, #0b0d10)" />
    </svg>
  );
}

export function WindowsPaneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <rect x="3" y="3" width="8.3" height="8.3" rx="0.9" />
      <rect x="12.7" y="3" width="8.3" height="8.3" rx="0.9" />
      <rect x="3" y="12.7" width="8.3" height="8.3" rx="0.9" />
      <rect x="12.7" y="12.7" width="8.3" height="8.3" rx="0.9" />
    </svg>
  );
}
