"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "now" },
  { href: "/diary", label: "diary" },
  { href: "/rooms", label: "rooms" },
  { href: "/places", label: "places" },
  { href: "/ember", label: "ember" },
  { href: "/me", label: "me" },
] as const;

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/unlock") return null;
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" className="brand">
        timeflow
      </Link>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
