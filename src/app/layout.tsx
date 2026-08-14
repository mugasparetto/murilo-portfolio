import { PrismicPreview } from "@prismicio/next";
import { repositoryName } from "@/prismicio";

import ClientProvider from "./components/ClientProvider";
import SiteNav from "./components/SiteNav";

import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ClientProvider>{children}</ClientProvider>
        {/* outside the provider: fixed to the viewport, so it belongs to the
            page rather than the scroller or the canvas */}
        <SiteNav />
      </body>
      <PrismicPreview repositoryName={repositoryName} />
    </html>
  );
}
