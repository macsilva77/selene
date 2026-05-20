import type { Metadata } from 'next';
import { Inter, Geist } from 'next/font/google';
import { SeleneProviders } from '@selene/providers';
import './globals.css';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'EOS — Plataforma Core',
  description: 'Gestão integrada de fornecedores, contratos e certificados digitais',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={cn("font-sans", geist.variable)}>
      <body className="antialiased">
        <SeleneProviders>{children}</SeleneProviders>
      </body>
    </html>
  );
}
