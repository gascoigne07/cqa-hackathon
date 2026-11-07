import { makeStyles, mergeClasses } from "@fluentui/react-components";
import { useEffect, useRef } from "react";
import type { Turn } from "../api/contract";
import { SPEAKER_LABEL, formatSeconds, timeLabel } from "../lib/format";
import { derived, eventColor, font, palette, type, type EventKind } from "../theme";

export interface Focus {
  indices: number[]; // turn idx values to highlight as evidence
  range?: [number, number] | null; // checked range (idx)
  nonce: number; // changes on every click so the same target can be re-focused
  /** colour of the highlight (event kind); default = attention */
  kind?: EventKind;
  /** scroll without smoothing (scrubbing the strip) */
  instant?: boolean;
}

/* The transcript is typeset like a printed document: a narrow gutter with the
   time and the speaker, the text in Literata at ~70 characters per line. */
const useStyles = makeStyles({
  doc: { display: "flex", flexDirection: "column", padding: "4px 0 12px" },
  row: {
    display: "grid",
    gridTemplateColumns: "76px minmax(0, 1fr)",
    columnGap: "16px",
    padding: "7px 12px 7px 10px",
    borderLeft: "3px solid transparent",
    transitionProperty: "background-color, border-color",
    transitionDuration: "160ms",
    "@media (max-width: 600px)": { gridTemplateColumns: "56px minmax(0, 1fr)", columnGap: "10px" },
  },
  clickable: { cursor: "pointer", ":hover": { backgroundColor: derived.raisedHover } },
  gutter: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    paddingTop: "3px",
    fontFamily: font.ui,
    fontSize: type.xs,
    lineHeight: "16px",
    color: derived.graphiteStrong,
    fontVariantNumeric: "tabular-nums",
  },
  who: { fontWeight: 600, color: palette.ink },
  whoQuiet: { fontWeight: 500, color: derived.graphiteStrong },
  idx: { color: palette.graphite },
  text: {
    fontFamily: font.doc,
    fontSize: type.doc,
    lineHeight: "1.62",
    color: palette.ink,
    maxWidth: "68ch",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
  },
  bot: { color: "#2C3934" },
  system: {
    fontFamily: font.ui,
    fontSize: type.sm,
    lineHeight: "1.5",
    fontStyle: "italic",
    color: derived.graphiteStrong,
  },
  inRange: { borderLeftColor: palette.grid, borderLeftStyle: "dashed" },
  playing: { borderLeftColor: palette.ink },
});

interface Props {
  turns: Turn[];
  offsets?: (number | null)[];
  focus?: Focus | null;
  playingIdx?: number | null; // follow-along while the recording plays
  onTurnClick?: (idx: number) => void;
}

function scrollIntoBox(el: HTMLElement, instant?: boolean) {
  const behavior: ScrollBehavior = instant ? "auto" : "smooth";
  const box = el.closest<HTMLElement>("[data-scroll-container]");
  if (!box) {
    el.scrollIntoView({ behavior, block: "nearest" });
    return;
  }
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  box.scrollTo({ top: top - box.clientHeight / 3, behavior });
}

export function TranscriptView({ turns, offsets, focus, playingIdx, onTurnClick }: Props) {
  const s = useStyles();
  const refs = useRef(new Map<number, HTMLDivElement>());

  // jump to evidence / checked range / scrub position
  useEffect(() => {
    if (!focus) return;
    const target = focus.indices[0] ?? focus.range?.[0];
    const el = target != null ? refs.current.get(target) : undefined;
    if (el) scrollIntoBox(el, focus.instant);
  }, [focus]);

  // follow the recording
  useEffect(() => {
    if (playingIdx == null) return;
    const el = refs.current.get(playingIdx);
    if (el) scrollIntoBox(el);
  }, [playingIdx]);

  const ev = new Set(focus?.indices ?? []);
  const [lo, hi] = focus?.range ?? [-1, -2];
  const hl = eventColor[focus?.kind ?? "risk"];

  return (
    <div className={s.doc}>
      {turns.map((t, i) => {
        const offset = offsets?.[i];
        const isEvidence = ev.has(t.idx);
        const quiet = t.speaker === "system" || t.speaker === "bot";
        return (
          <div
            key={t.idx}
            id={`turn-${t.idx}`}
            data-idx={t.idx}
            ref={(el) => {
              if (el) refs.current.set(t.idx, el);
              else refs.current.delete(t.idx);
            }}
            className={mergeClasses(
              s.row,
              onTurnClick && s.clickable,
              t.idx >= lo && t.idx <= hi && s.inRange,
              playingIdx === t.idx && s.playing,
            )}
            style={isEvidence ? { backgroundColor: hl.tint, borderLeftColor: hl.fill, borderLeftStyle: "solid" } : undefined}
            onClick={onTurnClick ? () => onTurnClick(t.idx) : undefined}
            title={onTurnClick && offset != null ? `Перемотать запись к ${formatSeconds(offset)}` : undefined}
          >
            <div className={s.gutter}>
              <span title={t.timestamp}>{/^\d{4}-/.test(t.timestamp) && offset != null ? formatSeconds(offset) : timeLabel(t.timestamp)}</span>
              <span className={quiet ? s.whoQuiet : s.who}>{SPEAKER_LABEL[t.speaker]}</span>
              <span className={s.idx}>#{t.idx}</span>
            </div>
            <p className={mergeClasses(s.text, t.speaker === "bot" && s.bot, t.speaker === "system" && s.system)}>{t.text}</p>
          </div>
        );
      })}
    </div>
  );
}
