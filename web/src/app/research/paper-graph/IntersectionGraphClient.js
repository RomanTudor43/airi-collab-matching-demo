"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ─── Layout constants ────────────────────────────────────────────────────────
const MAP_W = 2800;
const MAP_H = 1800;
const NODE_R = 18;
const MIN_DIST = 160;
const NODE_NAV_DRAG_TOLERANCE = 6;
const SIDE_GUTTER = 170;

// ─── Seeded pseudo-random (LCG) ──────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0xffffffff;
  };
}

const withAlpha = (hex, alpha) => {
  const raw = typeof hex === "string" ? hex.replace("#", "") : "";
  if (raw.length !== 3 && raw.length !== 6) return `rgba(255,255,255,${alpha})`;
  const value = raw.length === 3
    ? raw.split("").map((c) => c + c).join("")
    : raw;
  const intVal = parseInt(value, 16);
  const r = (intVal >> 16) & 255;
  const g = (intVal >> 8) & 255;
  const b = intVal & 255;
  return `rgba(${r},${g},${b},${alpha})`;
};

// ─── Build star field ────────────────────────────────────────────────────────
function buildStars(count) {
  const rng = makeRng(0xdeadbeef);
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    cx: rng() * MAP_W,
    cy: rng() * MAP_H,
    r: rng() * 1.3 + 0.2,
    opacity: rng() * 0.7 + 0.15,
  }));
}
const STARS = buildStars(600);

// ─── Position nodes with side gravity ───────────────────────────────────────
function buildBiasedPositions(items, sideById) {
  const PAD = 140;
  const mid = MAP_W / 2;
  const leftMax = mid - SIDE_GUTTER;
  const rightMin = mid + SIDE_GUTTER;
  const leftAnchor = (PAD + leftMax) / 2;
  const rightAnchor = (rightMin + MAP_W - PAD) / 2;
  const rng = makeRng(0xc0ffee + items.length * 7);

  const pos = items.map((item) => {
    const side = sideById[item.id] === "right" ? "right" : "left";
    const anchor = side === "right" ? rightAnchor : leftAnchor;
    const span = (leftMax - PAD) * 0.7;
    return {
      x: anchor + (rng() - 0.5) * span,
      y: PAD + rng() * (MAP_H - PAD * 2),
      side,
    };
  });

  for (let pass = 0; pass < 30; pass++) {
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (d < MIN_DIST) {
          const f = ((MIN_DIST - d) / d) * 0.5;
          pos[i].x -= dx * f;
          pos[i].y -= dy * f;
          pos[j].x += dx * f;
          pos[j].y += dy * f;
        }
      }
      const anchor = pos[i].side === "right" ? rightAnchor : leftAnchor;
      const pull = 0.08;
      pos[i].x += (anchor - pos[i].x) * pull;

      if (pos[i].side === "right") {
        pos[i].x = Math.max(rightMin, Math.min(MAP_W - PAD, pos[i].x));
      } else {
        pos[i].x = Math.max(PAD, Math.min(leftMax, pos[i].x));
      }
      pos[i].y = Math.max(PAD, Math.min(MAP_H - PAD, pos[i].y));
    }
  }

  return pos;
}

// ─── Link visual style by score ──────────────────────────────────────────────
function linkStyle(score) {
  if (score >= 0.8) return { stroke: "#ffe066", width: 2.2, opacity: 0.85, dash: "none" };
  if (score >= 0.65) return { stroke: "#ff8c00", width: 1.5, opacity: 0.7, dash: "none" };
  return { stroke: "#4d7fff", width: 0.9, opacity: 0.45, dash: "none" };
}

// ─── Grid lines ──────────────────────────────────────────────────────────────
const GRID_COLS = Array.from({ length: Math.ceil(MAP_W / 220) + 1 }, (_, i) => i * 220);
const GRID_ROWS = Array.from({ length: Math.ceil(MAP_H / 220) + 1 }, (_, i) => i * 220);

// ─── Component ───────────────────────────────────────────────────────────────
export default function IntersectionGraphClient({
  publications = [],
  links = [],
  leftMacro,
  rightMacro,
}) {
  const router = useRouter();
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const nodePressRef = useRef(null);

  const [minScore, setMinScore] = useState(0.5);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const [panning, setPanning] = useState(false);
  const panOrigin = useRef(null);
  const [hovered, setHovered] = useState(null);

  const sideById = useMemo(() => {
    const map = {};
    publications.forEach((paper) => {
      const slug = paper.graphMacroPrimary?.slug;
      map[paper.id] = slug === rightMacro?.slug ? "right" : "left";
    });
    return map;
  }, [publications, rightMacro]);

  const paperById = useMemo(() => {
    const m = {};
    publications.forEach((p) => { m[p.id] = p; });
    return m;
  }, [publications]);

  const visibleLinks = useMemo(() => {
    const ids = new Set(publications.map((p) => p.id));
    return links.filter((l) => {
      if (!ids.has(l.sourceId) || !ids.has(l.targetId)) return false;
      if (l.score < minScore) return false;
      return true;
    });
  }, [publications, links, minScore]);

  const nodeRadius = useCallback((paper) => {
    const citations = paper.cited_by || 0;
    return NODE_R * 0.8 + Math.min(12, Math.sqrt(citations) * 1.2);
  }, []);

  const paperPositions = useMemo(() => {
    const posArray = buildBiasedPositions(publications, sideById);
    const m = {};
    publications.forEach((p, i) => { m[p.id] = posArray[i]; });
    return m;
  }, [publications, sideById]);

  const linksByPaper = useMemo(() => {
    const idx = {};
    visibleLinks.forEach((l) => {
      (idx[l.sourceId] ??= []).push(l);
      (idx[l.targetId] ??= []).push(l);
    });
    return idx;
  }, [visibleLinks]);

  const connectedSet = useMemo(() => {
    if (!hovered) return null;
    const s = new Set([hovered]);
    (linksByPaper[hovered] ?? []).forEach((l) => {
      s.add(l.sourceId);
      s.add(l.targetId);
    });
    return s;
  }, [hovered, linksByPaper]);

  const fitToScreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    const s = Math.min(cw / MAP_W, ch / MAP_H) * 0.92;
    setScale(s);
    setTx((cw - MAP_W * s) / 2);
    setTy((ch - MAP_H * s) / 2);
  }, []);
  useEffect(() => { fitToScreen(); }, [fitToScreen]);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest("[data-node]")) return;
    setPanning(true);
    panOrigin.current = { mx: e.clientX, my: e.clientY, tx, ty };
  }, [tx, ty]);

  const onMouseMove = useCallback((e) => {
    if (!panning || !panOrigin.current) return;
    setTx(panOrigin.current.tx + e.clientX - panOrigin.current.mx);
    setTy(panOrigin.current.ty + e.clientY - panOrigin.current.my);
  }, [panning]);

  const onMouseUp = useCallback(() => {
    setPanning(false);
    panOrigin.current = null;
    nodePressRef.current = null;
  }, []);

  const onNodeMouseDown = useCallback((e, publicationId) => {
    if (e.button !== 0) return;
    nodePressRef.current = { publicationId, x: e.clientX, y: e.clientY };
  }, []);

  const onNodeMouseUp = useCallback((e, publication) => {
    if (e.button !== 0 || !publication.publicationHref) return;
    const press = nodePressRef.current;
    nodePressRef.current = null;
    if (!press || press.publicationId !== publication.id) return;

    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved > NODE_NAV_DRAG_TOLERANCE) return;

    router.push(publication.publicationHref);
  }, [router]);

  const onNodeKeyDown = useCallback((e, publication) => {
    if (!publication.publicationHref) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    router.push(publication.publicationHref);
  }, [router]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      setScale((s) => {
        const next = Math.max(0.2, Math.min(4, s * factor));
        setTx((t) => mx - (mx - t) * (next / s));
        setTy((t) => my - (my - t) * (next / s));
        return next;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const tooltipData = useMemo(() => {
    if (!hovered) return null;
    const paper = paperById[hovered];
    const pos = paperPositions[hovered];
    if (!paper || !pos) return null;
    return {
      paper,
      sx: tx + pos.x * scale,
      sy: ty + pos.y * scale,
    };
  }, [hovered, paperById, paperPositions, tx, ty, scale]);

  const hovLinks = tooltipData ? (linksByPaper[tooltipData.paper.id] ?? []) : [];

  const leftColor = leftMacro?.color || "#4ecdc4";
  const rightColor = rightMacro?.color || "#ff6b6b";

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden select-none"
      style={{
        height: "calc(100vh - 4rem)",
        background: "#03070f",
        cursor: panning ? "grabbing" : "grab",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* CRT scanlines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.12) 2px,rgba(0,0,0,0.12) 4px)",
          mixBlendMode: "multiply",
        }}
      />

      {/* Corner brackets */}
      {[
        "top-3 left-3 border-t-2 border-l-2",
        "top-3 right-3 border-t-2 border-r-2",
        "bottom-3 left-3 border-b-2 border-l-2",
        "bottom-3 right-3 border-b-2 border-r-2",
      ].map((cls) => (
        <div key={cls} aria-hidden className={`pointer-events-none absolute ${cls} border-amber-500/30 w-8 h-8 z-30`} />
      ))}

      {/* Back navigation */}
      <div className="absolute top-4 left-5 z-40 flex items-center gap-3 font-mono text-[10px]">
        <Link
          href={`/research/paper-graph/${leftMacro?.slug}`}
          className="text-amber-400 border border-amber-500/40 px-2 py-0.5 hover:bg-amber-500/20 transition-colors"
        >
          ◂ BACK
        </Link>
        <Link
          href={`/research/paper-graph/${leftMacro?.slug}`}
          className="text-[10px] px-1.5 py-0.5 border border-transparent"
          style={{ color: leftColor }}
        >
          {leftMacro?.name || "Left"}
        </Link>
        <span className="text-amber-500/40">×</span>
        <Link
          href={`/research/paper-graph/${rightMacro?.slug}`}
          className="text-[10px] px-1.5 py-0.5 border border-transparent"
          style={{ color: rightColor }}
        >
          {rightMacro?.name || "Right"}
        </Link>
      </div>

      {/* Top-left HUD */}
      <div className="pointer-events-none absolute top-12 left-5 z-30 font-mono">
        <div className="text-amber-400/50 text-[10px] tracking-widest">
          {publications.length} PAPERS &nbsp;·&nbsp; {visibleLinks.length} LINKS
        </div>
      </div>

      {/* Top-right HUD */}
      <div className="pointer-events-none absolute top-4 right-5 z-30 font-mono text-right">
        <div className="text-amber-400/50 text-[10px] tracking-widest">AI RESEARCH INSTITUTE</div>
        <div className="text-amber-500/25 text-[9px] tracking-widest mt-0.5">DEMOCRACY SCIENCE DIVISION</div>
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-6 left-5 z-30 font-mono text-[10px]">
        <div className="text-amber-500/50 tracking-widest mb-2">LINK STRENGTH</div>
        {[
          { color: "#4d7fff", label: "WEAK   0.50–0.65", w: 1 },
          { color: "#ff8c00", label: "MODERATE  0.65–0.80", w: 2 },
          { color: "#ffe066", label: "STRONG  0.80–1.00", w: 3 },
        ].map(({ color, label, w }) => (
          <div key={label} className="flex items-center gap-2 mb-1">
            <svg width="24" height={w + 4}>
              <line
                x1="0" y1={(w + 4) / 2} x2="24" y2={(w + 4) / 2}
                stroke={color} strokeWidth={w}
              />
            </svg>
            <span style={{ color }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Controls hint */}
      <div className="pointer-events-none absolute bottom-6 right-5 z-30 font-mono text-[9px] text-amber-500/30 text-right tracking-widest">
        <div>SCROLL TO ZOOM</div>
        <div>DRAG TO PAN</div>
        <div>CLICK NODE TO OPEN PAGE</div>
        <div>HOVER NODE FOR INTEL</div>
      </div>

      {/* Filter controls */}
      <div
        className="absolute bottom-20 right-5 z-40 font-mono text-[9px]"
        style={{
          background: "rgba(3,7,15,0.92)",
          border: "1px solid rgba(255,180,0,0.25)",
          padding: "10px 14px",
        }}
      >
        <div className="text-amber-500/60 tracking-widest mb-2">FILTERS</div>
        <label className="flex items-center gap-2 text-amber-400/70">
          <span className="w-20">MIN SCORE</span>
          <input
            type="range" min="0.3" max="0.9" step="0.05"
            value={minScore}
            onChange={(e) => setMinScore(parseFloat(e.target.value))}
            className="w-20 accent-amber-500"
          />
          <span className="text-amber-300 w-8 text-right">{minScore.toFixed(2)}</span>
        </label>
      </div>

      {/* SVG */}
      <svg
        ref={svgRef}
        width={MAP_W}
        height={MAP_H}
        aria-label="Macro intersection map"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          overflow: "visible",
          transformOrigin: "top left",
          transform: `translate(${tx}px,${ty}px) scale(${scale})`,
          willChange: "transform",
        }}
      >
        <defs>
          <radialGradient id="nebula1" cx="30%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#0d2a5e" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#03070f" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="nebula2" cx="70%" cy="65%" r="50%">
            <stop offset="0%" stopColor="#1a0d3d" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#03070f" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="side-split" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={leftColor} stopOpacity="0.12" />
            <stop offset="45%" stopColor="#03070f" stopOpacity="0" />
            <stop offset="55%" stopColor="#03070f" stopOpacity="0" />
            <stop offset="100%" stopColor={rightColor} stopOpacity="0.12" />
          </linearGradient>
          <radialGradient id="ng" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff8c00" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ff8c00" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ng-hot" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffe066" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#ffe066" stopOpacity="0" />
          </radialGradient>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-hot" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect width={MAP_W} height={MAP_H} fill="#03070f" />
        <rect width={MAP_W} height={MAP_H} fill="url(#nebula1)" />
        <rect width={MAP_W} height={MAP_H} fill="url(#nebula2)" />
        <rect width={MAP_W} height={MAP_H} fill="url(#side-split)" />

        {STARS.map((s) => (
          <circle key={s.id} cx={s.cx} cy={s.cy} r={s.r} fill="white" opacity={s.opacity} />
        ))}

        {GRID_COLS.map((x) => (
          <line key={`gc${x}`} x1={x} y1={0} x2={x} y2={MAP_H}
            stroke="rgba(80,160,255,0.035)" strokeWidth="1" />
        ))}
        {GRID_ROWS.map((y) => (
          <line key={`gr${y}`} x1={0} y1={y} x2={MAP_W} y2={y}
            stroke="rgba(80,160,255,0.035)" strokeWidth="1" />
        ))}

        <line
          x1={MAP_W / 2}
          y1={80}
          x2={MAP_W / 2}
          y2={MAP_H - 80}
          stroke="rgba(255,200,120,0.08)"
          strokeDasharray="8 10"
        />

        {/* Links */}
        {visibleLinks.map((l) => {
          const a = paperPositions[l.sourceId];
          const b = paperPositions[l.targetId];
          if (!a || !b) return null;
          const { stroke, width, opacity, dash } = linkStyle(l.score);
          const isActive = hovered && (l.sourceId === hovered || l.targetId === hovered);
          const isDim = hovered && !isActive;
          return (
            <line
              key={l.id}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={stroke}
              strokeWidth={isActive ? width * 3 : width}
              strokeDasharray={dash}
              opacity={isDim ? 0.04 : isActive ? 1 : opacity}
              style={{ transition: "opacity 0.18s, stroke-width 0.18s" }}
            />
          );
        })}

        {/* Nodes */}
        {publications.map((paper) => {
          const pos = paperPositions[paper.id];
          if (!pos) return null;
          const isNavigable = !!paper.publicationHref;
          const isHot = hovered === paper.id;
          const isNear = connectedSet?.has(paper.id) && !isHot;
          const isDim = hovered && !isHot && !isNear;
          const r = nodeRadius(paper);
          const showLabel = scale > 0.5 || isHot || isNear;
          const side = sideById[paper.id] === "right" ? "right" : "left";
          const sideColor = side === "right" ? rightColor : leftColor;

          return (
            <g
              key={paper.id}
              data-node="1"
              transform={`translate(${pos.x},${pos.y})`}
              style={{ cursor: isNavigable ? "pointer" : "default" }}
              role={isNavigable ? "link" : undefined}
              tabIndex={isNavigable ? 0 : undefined}
              aria-label={isNavigable ? `Open publication: ${paper.title}` : undefined}
              onMouseEnter={() => setHovered(paper.id)}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => onNodeMouseDown(e, paper.id)}
              onMouseUp={(e) => onNodeMouseUp(e, paper)}
              onKeyDown={(e) => onNodeKeyDown(e, paper)}
            >
              {(isHot || isNear) && (
                <circle
                  r={r * 3.5}
                  fill={isHot ? "url(#ng-hot)" : "url(#ng)"}
                  opacity={isDim ? 0 : isHot ? 0.9 : 0.55}
                />
              )}
              <circle
                r={r + 7}
                fill="none"
                stroke={sideColor}
                strokeWidth={isHot ? 1.6 : 1.1}
                strokeDasharray={isHot ? "none" : "5 4"}
                opacity={isDim ? 0.08 : isHot ? 0.8 : isNear ? 0.55 : 0.25}
                style={{ transition: "all 0.2s" }}
              />
              <circle
                r={r}
                fill={isHot ? "#152540" : "#0a1a30"}
                stroke={isHot ? "#ffe066" : isNear ? "#ff8c00" : "#1e4d80"}
                strokeWidth={isHot ? 2.5 : 1.5}
                opacity={isDim ? 0.15 : 1}
                filter={isHot ? "url(#glow-hot)" : isNear ? "url(#glow)" : undefined}
                style={{ transition: "all 0.2s" }}
              />
              <text
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fontFamily="monospace"
                fill={withAlpha(sideColor, isDim ? 0.2 : isHot ? 1 : 0.7)}
                style={{ transition: "all 0.2s", userSelect: "none", pointerEvents: "none" }}
              >
                {paper.year ?? "?"}
              </text>
              {showLabel && (
                <text
                  y={r + 13}
                  textAnchor="middle"
                  fontSize={7}
                  fontFamily="monospace"
                  fill={withAlpha(sideColor, isDim ? 0.18 : isHot ? 0.85 : 0.55)}
                  style={{ transition: "all 0.2s", userSelect: "none", pointerEvents: "none" }}
                >
                  {(paper.title ?? "").slice(0, 24)}
                  {(paper.title ?? "").length > 24 ? "…" : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Intel tooltip */}
      {tooltipData && (
        <IntelPanel
          paper={tooltipData.paper}
          links={hovLinks}
          paperById={paperById}
          sx={tooltipData.sx}
          sy={tooltipData.sy}
          scale={scale}
        />
      )}
    </div>
  );
}

// ─── Intel panel ───────────────────────────────────────────────────────────────
function IntelPanel({ paper, links, paperById, sx, sy, scale }) {
  const panelW = 300;
  const panelH = 300;
  const containerW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const containerH = typeof window !== "undefined" ? window.innerHeight : 800;

  const r = NODE_R * scale;
  let left = sx + r + 10;
  let top = sy - panelH / 2;
  if (left + panelW > containerW - 10) left = sx - r - panelW - 10;
  if (top < 10) top = 10;
  if (top + panelH > containerH - 10) top = containerH - panelH - 10;

  const strong = links.filter((l) => l.score >= 0.8).length;
  const moderate = links.filter((l) => l.score >= 0.65 && l.score < 0.8).length;
  const weak = links.filter((l) => l.score < 0.65).length;

  return (
    <div className="pointer-events-none absolute z-40 font-mono" style={{ left, top, width: panelW }}>
      <div className="flex items-center gap-1 mb-0.5 px-1">
        <div className="h-px flex-1 bg-amber-500/40" />
        <span className="text-amber-500/50 text-[8px] tracking-[0.3em]">INTEL</span>
        <div className="h-px flex-1 bg-amber-500/40" />
      </div>
      <div style={{
        background: "rgba(3,7,15,0.96)",
        border: "1px solid rgba(255,180,0,0.35)",
        boxShadow: "0 0 24px rgba(255,140,0,0.18), inset 0 0 18px rgba(255,140,0,0.04)",
        padding: "14px 16px",
      }}>
        <div className="text-amber-300 text-[11px] font-bold leading-snug mb-2">{paper.title}</div>
        <div className="flex gap-4 text-[10px] text-amber-500/60 tracking-wider mb-2">
          {paper.year && <span>◈ {paper.year}</span>}
          {paper.cited_by != null && <span>⬡ {paper.cited_by} citations</span>}
          <span>⇌ {links.length} links</span>
        </div>
        {paper.topics?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {paper.topics.map((t, idx) => (
              <span key={`${t}-${idx}`} className="text-amber-400/70 border border-amber-500/30 px-1.5 py-0.5"
                style={{ fontSize: 8, letterSpacing: "0.06em" }}>
                {t}
              </span>
            ))}
          </div>
        )}
        {paper.abstract && (
          <div className="text-blue-200/50 leading-relaxed border-t border-amber-500/20 pt-2 mt-1"
            style={{ fontSize: 9 }}>
            {paper.abstract.slice(0, 220)}…
          </div>
        )}
        {links.length > 0 && (
          <div className="flex gap-3 mt-2 pt-2 border-t border-amber-500/15" style={{ fontSize: 9 }}>
            {strong > 0 && <span style={{ color: "#ffe066" }}>◆ {strong} strong</span>}
            {moderate > 0 && <span style={{ color: "#ff8c00" }}>◆ {moderate} moderate</span>}
            {weak > 0 && <span style={{ color: "#4d7fff" }}>◆ {weak} weak</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 mt-0.5 px-1">
        <div className="h-px flex-1 bg-amber-500/25" />
        <span className="text-amber-500/25 text-[7px] tracking-[0.3em]">
          {paper.openAlexId?.split("/").at(-1) ?? ""}
        </span>
        <div className="h-px flex-1 bg-amber-500/25" />
      </div>
    </div>
  );
}
