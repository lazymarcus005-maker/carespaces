import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: 'Carespaces Ops',
  description: 'Admin and Care Ops workspace',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
