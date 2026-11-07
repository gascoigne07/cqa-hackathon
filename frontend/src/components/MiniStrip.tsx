import type { EventKind } from "../theme";
import { eventColor, palette } from "../theme";

/** The journal-row echo of the recording strip: the dialog as a line, events as ticks. */
export function MiniStrip({ marks, width = 168, empty }: { marks: { pos: number; kind: EventKind }[]; width?: number; empty?: string }) {
  const h = 20;
  const x = (p: number) => 3 + p * (width - 6);
  const label = marks.length
    ? `События: ${marks.filter((m) => m.kind === "violation").length} нарушений, ${marks.filter((m) => m.kind === "risk").length} рисков`
    : empty ?? "Нет событий";
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={label} style={{ display: "block", overflow: "visible" }}>
      <line x1={0} x2={width} y1={h / 2} y2={h / 2} stroke={palette.grid} strokeWidth={1} />
      <line x1={0.5} x2={0.5} y1={h / 2 - 3} y2={h / 2 + 3} stroke={palette.graphite} strokeWidth={1} />
      <line x1={width - 0.5} x2={width - 0.5} y1={h / 2 - 3} y2={h / 2 + 3} stroke={palette.graphite} strokeWidth={1} />
      {marks.map((m, i) =>
        m.kind === "good" ? (
          <circle key={i} cx={x(m.pos)} cy={h / 2} r={2.2} fill={eventColor.good.fill} />
        ) : (
          <rect key={i} x={x(m.pos) - 1.25} y={m.kind === "violation" ? 2 : 5} width={2.5} height={m.kind === "violation" ? h - 4 : h - 10} fill={eventColor[m.kind].fill} />
        ),
      )}
    </svg>
  );
}
