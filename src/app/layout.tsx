import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Harvest Beer Festival - Volunteer Portal",
  description: "Volunteer management portal for the Harvest Beer Festival",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-amber-50 text-gray-900">
        <nav className="bg-amber-800 text-amber-50 shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <a
              href={process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL || "/"}
              className="flex items-center gap-2 text-xl font-bold tracking-tight hover:text-amber-200 transition-colors"
            >
              <span className="text-2xl">🍺</span>
              <span>Harvest Beer Festival</span>
            </a>
            <div className="flex gap-4 text-sm font-medium">
              <a href="/volunteer" className="hover:text-amber-200 transition-colors">
                Volunteer Portal
              </a>
              <a href="/admin" className="hover:text-amber-200 transition-colors">
                Admin
              </a>
            </div>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
        <footer className="bg-amber-900 text-amber-200 text-center py-4 text-sm">
          Harvest Beer Festival Volunteer Management
        </footer>
      </body>
    </html>
  );
}
