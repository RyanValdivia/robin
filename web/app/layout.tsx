import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Robin",
  description: "Asistente personal",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="h-dvh overflow-hidden font-sans antialiased text-gray-200">{children}</body>
    </html>
  );
}
