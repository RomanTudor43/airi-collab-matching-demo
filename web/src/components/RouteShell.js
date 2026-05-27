"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DarkModeBubble from "@/components/DarkModeBubble";

const FULLSCREEN_GRAPH_ROUTE = /^\/research\/paper-graph(\/|$)/;

export default function RouteShell({ children }) {
  const pathname = usePathname();
  const isGraphRoute = FULLSCREEN_GRAPH_ROUTE.test(pathname || "");

  if (isGraphRoute) {
    return (
      <div className="relative min-h-screen w-full overflow-hidden bg-[#02050b] text-white">
        <Link
          href="/"
          className="fixed left-4 top-4 z-50 rounded-full border border-amber-400/25 bg-slate-950/70 px-3 py-2 font-mono text-[10px] tracking-[0.25em] text-amber-100 shadow-lg shadow-black/30 backdrop-blur-md transition hover:border-amber-300/40 hover:bg-slate-900/80 hover:text-amber-50"
        >
          HOME
        </Link>
        <div className="h-screen w-full">{children}</div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <main className="flex-grow">
        {children}
      </main>
      <DarkModeBubble />
      <Footer />
    </>
  );
}
