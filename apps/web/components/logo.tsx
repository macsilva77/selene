import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  showTagline?: boolean;
  short?: boolean;
}

export function Logo({ className, showTagline = false, short = false }: LogoProps) {
  return (
    <div className={cn('flex flex-col items-start', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={short ? '/logo-short.png' : '/logo-positivo.png'}
        alt="EOS"
        className={short ? 'h-8 w-8 object-contain' : 'h-8 w-auto object-contain'}
      />
      {showTagline && (
        <span className="text-xs text-sidebar-foreground/60 mt-0.5">Plataforma Core</span>
      )}
    </div>
  );
}
