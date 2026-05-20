import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, id, ...props }, ref) => {
    const inputEl = (
      <input
        id={id}
        type={type}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-card px-4 py-2.5 text-base text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );

    if (label) {
      return (
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </label>
          {inputEl}
        </div>
      );
    }

    return inputEl;
  }
);
Input.displayName = 'Input';

export { Input };
