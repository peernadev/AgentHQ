import type { SVGProps } from "react";

export function AgentHQMark({
  className,
  children,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      {children}
      <path d="M8 12h3.5M11.5 8.25v7.5M11.5 8.25H15M11.5 15.75H15" />
      <rect x="3" y="6" width="5" height="12" rx="1" />
      <rect x="15" y="6" width="6" height="4.5" rx="1" />
      <rect x="15" y="13.5" width="6" height="4.5" rx="1" />
    </svg>
  );
}
