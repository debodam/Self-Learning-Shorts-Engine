"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardCheck,
  Lightbulb,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/review", label: "Review", icon: ClipboardCheck },
  { href: "/performance", label: "Performance", icon: BarChart3 },
  { href: "/learnings", label: "Learnings", icon: Lightbulb },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-line bg-surface">
      <Link href="/" className="flex items-center gap-2 px-4 py-5">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="size-4" strokeWidth={2.5} />
        </span>
        <span className="text-[17px] font-semibold tracking-tight text-heading">
          Aced Shorts Engine
        </span>
      </Link>

      <nav className="flex flex-col gap-0.5 px-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors ${
                active
                  ? "bg-primary-tint font-medium text-primary"
                  : "text-body hover:bg-page"
              }`}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
