import { PrismicPreview } from "@prismicio/next";
import { repositoryName } from "@/prismicio";

import ClientProvider from "./components/ClientProvider";

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
        <ClientProvider>{children}</ClientProvider>
      </body>
      <PrismicPreview repositoryName={repositoryName} />
    </html>
  );
}
