export function MetronomeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 21h8l-1.6-15h-4.8z" />
      <path d="M12 17L16 8" />
      <circle cx="15" cy="10.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function ZoomIcon({ plus, size = 22 }: { plus: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2M8.5 11h5" />
      {plus && <path d="M11 8.5v5" />}
    </svg>
  );
}
