import { Link } from "wouter";

interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
}

// A signature geometric mark: a stylized "G" rendered as three power lines
// intersecting a data-center rack, in monochrome using currentColor.
export function BrandMark({ size = "md", showWordmark = true }: BrandMarkProps) {
  const dim = size === "sm" ? 20 : size === "lg" ? 32 : 24;
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 text-foreground hover:text-primary transition-colors"
      data-testid="link-brand-home"
      aria-label="GridSense home"
    >
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Rack silhouette */}
        <rect x="10" y="8" width="12" height="16" rx="1.5" stroke="currentColor" strokeWidth="2" />
        {/* Rack shelves */}
        <line x1="10" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.5" />
        <line x1="10" y1="17" x2="22" y2="17" stroke="currentColor" strokeWidth="1.5" />
        <line x1="10" y1="21" x2="22" y2="21" stroke="currentColor" strokeWidth="1.5" />
        {/* Signal dot */}
        <circle cx="16" cy="16" r="1.5" fill="currentColor" />
      </svg>
      {showWordmark && (
        <span className="text-sm font-semibold tracking-tight hidden sm:inline">
          GridSense
        </span>
      )}
    </Link>
  );
}
