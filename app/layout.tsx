import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import { APP_TITLE, APP_DESCRIPTION } from './lib/brand';

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#1E1E2A',
              color: '#E8E8F0',
              border: '1px solid rgba(255,255,255,0.08)',
              fontFamily: 'var(--font-body)',
            },
            success: { iconTheme: { primary: '#00D4AA', secondary: '#0A0A0F' } },
            error: { iconTheme: { primary: '#FF4D6D', secondary: '#0A0A0F' } },
          }}
        />
      </body>
    </html>
  );
}
