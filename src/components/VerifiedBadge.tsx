import React from 'react';

interface VerifiedBadgeProps {
  size?: number;
  className?: string;
  title?: string;
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  size = 14,
  className = '',
  title = 'Verified Official Account'
}) => {
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 select-none ${className}`}
      title={title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-blue-500 drop-shadow-2xs"
      >
        <path
          d="M10.29 2.86a2 2 0 0 1 3.42 0l.9 1.48a2 2 0 0 0 1.63.95l1.72.07a2 2 0 0 1 2.12 2.12l.07 1.72a2 2 0 0 0 .95 1.63l1.48.9a2 2 0 0 1 0 3.42l-1.48.9a2 2 0 0 0-.95 1.63l-.07 1.72a2 2 0 0 1-2.12 2.12l-1.72.07a2 2 0 0 0-1.63.95l-.9 1.48a2 2 0 0 1-3.42 0l-.9-1.48a2 2 0 0 0-1.63-.95l-1.72-.07a2 2 0 0 1-2.12-2.12l-.07-1.72a2 2 0 0 0-.95-1.63l-1.48-.9a2 2 0 0 1 0-3.42l1.48-.9a2 2 0 0 0 .95-1.63l.07-1.72a2 2 0 0 1 2.12-2.12l1.72-.07a2 2 0 0 0 1.63-.95l.9-1.48z"
          fill="#1D9BF0"
        />
        <path
          d="M9 12.5l2 2 4.5-4.5"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
};
