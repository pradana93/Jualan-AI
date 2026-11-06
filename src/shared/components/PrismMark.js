// PrismGate logo mark — a single beam entering a prism and splitting into a
// spectrum. Pure SVG, no imports, safe in both server and client components.
export default function PrismMark({ size = 36, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="pg-mark-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2A1652" />
          <stop offset="1" stopColor="#0D0819" />
        </linearGradient>
        <linearGradient id="pg-mark-beam" x1="18" y1="20" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C4B5FD" />
          <stop offset="0.45" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#F0ABFC" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#pg-mark-bg)" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="15.25" stroke="url(#pg-mark-beam)" strokeOpacity="0.45" strokeWidth="1.5" />
      <path d="M25 16 L43 32 L25 48 L19 48 L37 32 L19 16 Z" fill="url(#pg-mark-beam)" />
      <path d="M43 32 L50 21" stroke="#22D3EE" strokeWidth="2.4" strokeLinecap="round" strokeOpacity="0.9" />
      <path d="M43 32 L50 43" stroke="#F0ABFC" strokeWidth="2.4" strokeLinecap="round" strokeOpacity="0.9" />
      <circle cx="19" cy="16" r="1.6" fill="#EDE9FE" />
      <circle cx="19" cy="48" r="1.6" fill="#C4B5FD" />
    </svg>
  );
}
