import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Grizzly Estimator",
  description:
    "AI-assisted electrical walkthrough capture, estimating, proposal generation, and Housecall Pro handoff.",
  applicationName: "Grizzly Estimator",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Grizzly Estimator",
  },
  openGraph: {
    title: "Grizzly Estimator",
    description:
      "Turn walkthrough video, blueprints, and notes into reviewable electrical estimates and polished proposals.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#d96a28",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
