import { PrismicPreview } from "@prismicio/next";
import { repositoryName } from "@/prismicio";

import { ReactLenis } from "lenis/react";

import "./globals.css";

import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ReactLenis
          root
          options={{
            // put your Lenis options here
            lerp: 0.12,
            smoothWheel: true,
            autoRaf: false,
          }}
        >
          {children}
        </ReactLenis>
      </body>
      <PrismicPreview repositoryName={repositoryName} />
    </html>
  );
}
