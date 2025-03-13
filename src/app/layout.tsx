import "../styles/globals.css";

import { Analytics } from "@vercel/analytics/react";
import { Inter } from "next/font/google";
import Image from "next/image";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Assistants API Quickstart",
  description: "A quickstart template using the Assistants API with OpenAI",
  icons: {
    icon: "/openai.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <Image
          className="size-8 absolute top-0 right-0 m-4"
          src="/openai.svg"
          alt="OpenAI Logo"
          width={32}
          height={32}
        />
        <Analytics />
      </body>
    </html>
  );
}
