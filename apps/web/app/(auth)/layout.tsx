export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-positivo.png" alt="EOS" className="h-14 w-auto object-contain mb-2" />
          <p className="text-sidebar-foreground/60 text-sm">Plataforma Core</p>
        </div>
        {children}
      </div>
    </div>
  );
}
