import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "London Transport Pulse",
  description: "Live command centre for London's transport network"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
