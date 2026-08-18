import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://cutfish.msqt.fun'),
  title: 'Cutfish — Private browser video editor',
  description: 'Trim, merge, filter, sync, and export videos privately in your browser with WebAssembly.',
  applicationName: 'Cutfish',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'Cutfish — Private browser video editor',
    description: 'Fast, private video editing powered by WebAssembly. Your media stays on your device.',
    url: 'https://cutfish.msqt.fun',
    siteName: 'Cutfish',
    type: 'website',
  },
  twitter: { card: 'summary', title: 'Cutfish', description: 'Private video editing in your browser.' },
};

export const viewport: Viewport = { themeColor: '#111113', colorScheme: 'dark light' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
