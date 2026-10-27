import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Red Geoespacial de Respuesta Vecinal — Geo Relief Network",
  description:
    "Andamiaje inicial para coordinar donaciones y solicitudes de ayuda ante emergencias.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
