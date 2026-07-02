import type { Metadata, Viewport } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "My Next Bus",
  description: "A glanceable, live KMB and Citybus arrival board for home.",
  applicationName: "My Next Bus",
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: `${basePath}/bus-board-icon.svg`,
    shortcut: `${basePath}/bus-board-icon.svg`,
    apple: `${basePath}/bus-board-icon-192.png`,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "My Next Bus",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#07111f",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
