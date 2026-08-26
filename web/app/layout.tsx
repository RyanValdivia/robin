import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Robin",
  description: "Asistente personal",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// AppShell vive acá (no en cada page.tsx) a propósito: es lo que mantiene los
// 4 paneles montados entre navegaciones de tab (ver comentario en
// app-shell.tsx) — {children} son las rutas /chat, /memoria, /avisos, /uso,
// que no renderizan nada visible, solo existen para que la URL cambie.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="h-dvh overflow-hidden font-sans antialiased text-gray-200">
        <AppShell />
        {children}
      </body>
    </html>
  );
}
