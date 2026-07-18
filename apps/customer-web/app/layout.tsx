import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: 'Carespaces',
  description: 'พื้นที่ดูแลที่ไว้ใจได้',
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
