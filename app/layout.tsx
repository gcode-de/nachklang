import type { Metadata } from "next";
import "./globals.css";
import ThemeToggle from "./theme-toggle";
export const metadata: Metadata = {
  title: "Nachklang · Worte, die bleiben",
  description: "Persönliche Worte für Menschen, die dir wichtig sind.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" data-theme="dark">
      <body>
        <header className="site-header">
          <a className="brand" href="/">
            nachklang<span>WORTE, DIE BLEIBEN</span>
          </a>
          <nav className="actions">
            <ThemeToggle />
            <a className="nav-link" href="/dashboard">
              Meine Nachrichten ↗
            </a>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          <span>Nachklang · Ein persönlicher Ort für deine Worte.</span>
          <a href="/about">So funktioniert es & Datenschutz</a>
        </footer>
      </body>
    </html>
  );
}
