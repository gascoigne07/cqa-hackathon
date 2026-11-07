import { makeStyles, mergeClasses } from "@fluentui/react-components";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { DialogEvent } from "../lib/events";
import { formatSeconds } from "../lib/format";
import { derived, eventColor, font, motion, palette, radius, type } from "../theme";

/* Flight-recorder strip: the client-tension trace across the full width, a
   time ruler, and event marks under it. The only unprompted motion: on open the
   head sweeps once left→right while the trace is drawn. */

const H = 118;
const TRACE_MID = 34; // centre line of the trace
const TRACE_AMP = 24;
const AXIS_Y = 74;
const MARK_TOP = 80;
const MARK_H = 22;
const LABEL_Y = 113;

const useStyles = makeStyles({
  wrap: {
    position: "relative",
    width: "100%",
    height: `${H}px`,
    touchAction: "none",
    cursor: "ew-resize",
    userSelect: "none",
    borderRadius: radius.strip,
  },
  svg: { display: "block", width: "100%", height: "100%", overflow: "visible" },
  trace: {
    fill: "none",
    stroke: palette.ink,
    strokeWidth: 1.2,
    strokeLinejoin: "round",
    strokeDasharray: "1",
    animationName: { from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 } },
    animationDuration: `${motion.sweepMs}ms`,
    animationTimingFunction: "cubic-bezier(.4,0,.2,1)",
    animationFillMode: "both",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none", strokeDasharray: "none" },
  },
  head: {
    position: "absolute",
    top: "0",
    bottom: "14px",
    width: "1px",
    backgroundColor: palette.ink,
    pointerEvents: "none",
    animationName: {
      "0%": { left: "0%", opacity: 1 },
      "92%": { left: "100%", opacity: 1 },
      "100%": { left: "100%", opacity: 0 },
    },
    animationDuration: `${motion.sweepMs}ms`,
    animationTimingFunction: "cubic-bezier(.4,0,.2,1)",
    animationFillMode: "both",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none", opacity: 0 },
    "::before": {
      content: '""',
      position: "absolute",
      top: "-1px",
      left: "-4px",
      borderLeft: "4.5px solid transparent",
      borderRight: "4.5px solid transparent",
      borderTop: `6px solid ${palette.ink}`,
    },
  },
  cursor: {
    position: "absolute",
    top: "0",
    bottom: "14px",
    width: "1px",
    backgroundColor: palette.ink,
    pointerEvents: "none",
    transitionProperty: "left",
    transitionDuration: "60ms",
  },
  mark: { cursor: "pointer", outline: "none" },
  tip: {
    position: "absolute",
    bottom: `${H - MARK_TOP + 6}px`,
    transform: "translateX(-50%)",
    maxWidth: "260px",
    padding: "6px 9px",
    backgroundColor: palette.ink,
    color: derived.onInk,
    fontFamily: font.ui,
    fontSize: type.sm,
    lineHeight: "1.35",
    borderRadius: radius.control,
    pointerEvents: "none",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    zIndex: 2,
  },
  tipTime: { color: palette.grid, marginLeft: "6px", fontVariantNumeric: "tabular-nums" },
});

interface Props {
  duration: number;
  /** true when the axis is real time; false = turn positions */
  timed: boolean;
  events: DialogEvent[];
  tension: { t: number; v: number }[];
  selectedId: string | null;
  /** current position (scrub or audio), seconds */
  cursor: number | null;
  onHover: (e: DialogEvent | null) => void;
  onSelect: (e: DialogEvent) => void;
  onScrub: (t: number, done: boolean) => void;
  /** turn times, for keyboard stepping */
  stops: number[];
}

function niceStep(duration: number, width: number): number {
  const target = duration / Math.max(2, Math.floor(width / 90));
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => s >= target) ?? 3600;
}

export function RecordingStrip({ duration, timed, events, tension, selectedId, cursor, onHover, onSelect, onScrub, stops }: Props) {
  const s = useStyles();
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(960);
  const [tip, setTip] = useState<DialogEvent | null>(null);
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
  }, []);

  const x = (t: number) => (Math.min(Math.max(t, 0), duration) / duration) * w;

  // the trace: an oscillogram whose amplitude follows client tension
  const tracePath = useMemo(() => {
    const n = Math.max(240, Math.round(w / 2));
    const sigma = Math.max(duration / 30, timed ? 4 : 0.6);
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * duration;
      let a = 0.03;
      for (const p of tension) {
        const v = Math.max(0, (p.v - 0.15) / 0.85);
        a = Math.max(a, v * Math.exp(-(((t - p.t) / sigma) ** 2)));
      }
      const carrier = Math.sin(i * 1.9) * 0.75 + Math.sin(i * 0.53) * 0.25;
      const y = TRACE_MID - a * TRACE_AMP * carrier;
      pts.push(`${i === 0 ? "M" : "L"}${((i / n) * w).toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join("");
  }, [tension, duration, w, timed]);

  // marks at (almost) the same moment are spread apart; a leader line ties each to its true time
  const dispX = useMemo(() => {
    const out = new Map<string, number>();
    let prev = -Infinity;
    for (const e of [...events].filter((e) => e.kind !== "pause").sort((a, b) => a.t - b.t)) {
      const want = Math.min(Math.max((Math.min(Math.max(e.t, 0), duration) / duration) * w, 6), w - 6);
      const at = Math.min(Math.max(want, prev + 11), w - 6);
      out.set(e.id, at);
      prev = at;
    }
    return out;
  }, [events, duration, w]);

  const step = niceStep(duration, w);
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);

  const timeAt = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * duration;
  };
  const scrub = (clientX: number, done: boolean) => {
    const t = Math.min(Math.max(timeAt(clientX), 0), duration);
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onScrub(t, done));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("[data-mark]")) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub(e.clientX, false);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) scrub(e.clientX, false);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    scrub(e.clientX, true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("[data-mark]")) return;
    const now = cursor ?? 0;
    let next: number | undefined;
    if (e.key === "ArrowRight") next = stops.find((t) => t > now + 1e-6);
    else if (e.key === "ArrowLeft") next = [...stops].reverse().find((t) => t < now - 1e-6);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = duration;
    if (next == null) return;
    e.preventDefault();
    onScrub(next, true);
  };

  const show = (ev: DialogEvent | null) => {
    setTip(ev);
    onHover(ev);
  };
  const label = (t: number) => (timed ? formatSeconds(t) : `#${Math.round(t)}`);

  return (
    <div
      ref={wrap}
      className={s.wrap}
      role="slider"
      tabIndex={0}
      data-focusable
      aria-label="Лента записи диалога: перетаскивайте, чтобы перемотать расшифровку"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(cursor ?? 0)}
      aria-valuetext={label(cursor ?? 0)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <svg className={s.svg} viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none" aria-hidden={false}>
        {/* recorder paper: vertical grid at major ticks, centre line of the trace */}
        {ticks.map((t) => (
          <line key={`g${t}`} x1={x(t)} x2={x(t)} y1={4} y2={AXIS_Y} stroke={palette.grid} strokeWidth={1} />
        ))}
        <line x1={0} x2={w} y1={TRACE_MID} y2={TRACE_MID} stroke={palette.grid} strokeWidth={1} />
        {/* pauses sit on the paper as hatched spans */}
        <defs>
          <pattern id="cqa-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke={palette.graphite} strokeWidth="1.2" />
          </pattern>
        </defs>
        {events
          .filter((e) => e.kind === "pause" && e.t2 != null)
          .map((e) => (
            <rect key={`band-${e.id}`} x={x(e.t)} y={4} width={Math.max(2, x(e.t2!) - x(e.t))} height={AXIS_Y - 4} fill="url(#cqa-hatch)" opacity={0.18} />
          ))}
        <path className={s.trace} d={tracePath} pathLength={1} />
        {/* ruler */}
        <line x1={0} x2={w} y1={AXIS_Y} y2={AXIS_Y} stroke={palette.ink} strokeWidth={1} />
        {ticks.map((t) => (
          <g key={`t${t}`}>
            <line x1={x(t)} x2={x(t)} y1={AXIS_Y} y2={AXIS_Y + 5} stroke={palette.ink} strokeWidth={1} />
            <text
              x={Math.min(Math.max(x(t), 14), w - 14)}
              y={LABEL_Y}
              textAnchor="middle"
              fontFamily={font.ui}
              fontSize={11}
              fill={palette.ink}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {label(t)}
            </text>
          </g>
        ))}
        {/* event marks */}
        {events.map((e) => {
          const tx = x(e.t);
          const cx = dispX.get(e.id) ?? tx;
          const c = eventColor[e.kind];
          const selected = e.id === selectedId;
          const time = label(e.t);
          return (
            <g
              key={e.id}
              data-mark
              data-focusable
              className={s.mark}
              role="button"
              tabIndex={0}
              aria-label={`${e.title}, ${time}`}
              aria-pressed={selected}
              onMouseEnter={() => show(e)}
              onMouseLeave={() => show(null)}
              onFocus={() => show(e)}
              onBlur={() => show(null)}
              onClick={() => onSelect(e)}
              onKeyDown={(k) => {
                if (k.key === "Enter" || k.key === " ") {
                  k.preventDefault();
                  onSelect(e);
                }
              }}
            >
              <rect x={cx - 8} y={MARK_TOP - 4} width={16} height={MARK_H + 8} fill="transparent" />
              {selected ? (
                <rect x={cx - 6} y={MARK_TOP - 3} width={12} height={MARK_H + 6} fill="none" stroke={palette.ink} strokeWidth={1.2} />
              ) : null}
              {e.kind === "good" ? (
                <circle cx={cx} cy={MARK_TOP + MARK_H / 2} r={3.5} fill={c.fill} />
              ) : e.kind === "pause" ? (
                <>
                  <rect x={cx} y={MARK_TOP + MARK_H / 2 - 2} width={Math.max(3, x(e.t2 ?? e.t) - cx)} height={4} fill={c.fill} />
                  <rect x={cx - 1} y={MARK_TOP + 4} width={2} height={MARK_H - 8} fill={c.fill} />
                </>
              ) : (
                <>
                  <rect x={cx - 1.75} y={MARK_TOP} width={3.5} height={MARK_H} fill={c.fill} />
                  <path d={`M${cx - 4.5},${MARK_TOP} L${cx + 4.5},${MARK_TOP} L${cx},${MARK_TOP + 6} Z`} fill={c.fill} />
                </>
              )}
              {/* leader to the true moment on the ruler */}
              <line x1={tx} x2={cx} y1={AXIS_Y} y2={MARK_TOP - 1} stroke={c.fill} strokeWidth={1} />
            </g>
          );
        })}
      </svg>

      {/* the only unprompted motion: one sweep on open (prefers-reduced-motion → instant) */}
      <div className={s.head} aria-hidden />
      {cursor != null ? <div className={s.cursor} style={{ left: `${(x(cursor) / w) * 100}%` }} aria-hidden /> : null}

      {tip ? (
        <div className={mergeClasses(s.tip)} style={{ left: `${Math.min(Math.max(dispX.get(tip.id) ?? x(tip.t), 120), w - 120)}px` }} role="status">
          {tip.title}
          <span className={s.tipTime}>{label(tip.t)}</span>
        </div>
      ) : null}
    </div>
  );
}
