import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export function IconLanPort({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <rect x={4} y={5} width={16} height={14} rx={2.6} />
      <path d="M7 12.5h2m2 0h2m2 0h2" />
      <path d="M8 16h8l1-3H7l1 3Z" />
    </svg>
  );
}

export function IconComment({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d="M6.5 7h11a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5h-4l-3.5 3v-3h-3.5A2.5 2.5 0 0 1 4 13.5v-4A2.5 2.5 0 0 1 6.5 7Z" />
      <path d="M8 11h8m-8 3h5" />
    </svg>
  );
}

export function IconEdit({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d="m7 17 3.5-.5L18 9l-3-3-7.5 7.5L7 17Z" />
      <path d="M13 6.5 17.5 11" />
      <path d="M6 20h12" />
    </svg>
  );
}

export function IconTrash({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d="M5 7h14" />
      <path d="M10 5h4" />
      <path d="M14 5.2h3.2a.8.8 0 0 1 .8.8v1.5c0 .44-.36.8-.8.8H6.8a.8.8 0 0 1-.8-.8V6a.8.8 0 0 1 .8-.8H10" />
      <path d="M9 10v6.5M15 10v6.5" />
      <path d="M8 20h8a1 1 0 0 0 1-1V9H7v10a1 1 0 0 0 1 1Z" />
    </svg>
  );
}
