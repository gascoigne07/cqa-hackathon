import { Caption1, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { useEffect, useRef } from "react";
import type { Turn } from "../api/contract";
import { SPEAKER_LABEL, formatSeconds, timeLabel } from "../lib/format";

export interface Focus {
  indices: number[]; // turn idx values to highlight as evidence
  range?: [number, number] | null; // checked range (idx)
  nonce: number; // changes on every click so the same target can be re-focused
}

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column", gap: "6px", padding: "4px 2px" },
  row: {
    display: "flex",
    flexDirection: "column",
    maxWidth: "86%",
    ...shorthands.padding("8px", "12px"),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    ...shorthands.border("2px", "solid", "transparent"),
    transitionProperty: "border-color, box-shadow, background-color",
    transitionDuration: "200ms",
  },
  clickable: { cursor: "pointer" },
  operator: { alignSelf: "flex-end", backgroundColor: tokens.colorBrandBackground2 },
  client: { alignSelf: "flex-start", backgroundColor: tokens.colorNeutralBackground3 },
  bot: { alignSelf: "flex-start", backgroundColor: tokens.colorNeutralBackground2, color: tokens.colorNeutralForeground2 },
  system: {
    alignSelf: "center",
    maxWidth: "92%",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    ...shorthands.padding("2px", "8px"),
  },
  meta: { display: "flex", gap: "8px", color: tokens.colorNeutralForeground3, marginBottom: "2px" },
  idx: { fontVariantNumeric: "tabular-nums", fontWeight: tokens.fontWeightSemibold },
  text: { whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: tokens.lineHeightBase300 },
  evidence: {
    ...shorthands.borderColor(tokens.colorPaletteMarigoldBorderActive),
    boxShadow: `0 0 0 3px ${tokens.colorPaletteMarigoldBackground2}`,
  },
  inRange: { ...shorthands.borderColor(tokens.colorNeutralStroke1), ...shorthands.borderStyle("dashed") },
  playing: { ...shorthands.borderColor(tokens.colorBrandStroke1) },
});

interface Props {
  turns: Turn[];
  offsets?: (number | null)[];
  focus?: Focus | null;
  playingIdx?: number | null; // follow-along while the recording plays
  onTurnClick?: (idx: number) => void;
}

function scrollIntoBox(el: HTMLElement) {
  const box = el.closest<HTMLElement>("[data-scroll-container]");
  if (!box) {
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  box.scrollTo({ top: top - box.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
}

export function TranscriptView({ turns, offsets, focus, playingIdx, onTurnClick }: Props) {
  const s = useStyles();
  const refs = useRef(new Map<number, HTMLDivElement>());

  // jump to evidence / checked range
  useEffect(() => {
    if (!focus) return;
    const target = focus.indices[0] ?? focus.range?.[0];
    const el = target != null ? refs.current.get(target) : undefined;
    if (el) scrollIntoBox(el);
  }, [focus]);

  // follow the recording
  useEffect(() => {
    if (playingIdx == null) return;
    const el = refs.current.get(playingIdx);
    if (el) scrollIntoBox(el);
  }, [playingIdx]);

  const ev = new Set(focus?.indices ?? []);
  const [lo, hi] = focus?.range ?? [-1, -2];

  return (
    <div className={s.list}>
      {turns.map((t, i) => {
        const offset = offsets?.[i];
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
              s[t.speaker],
              onTurnClick && s.clickable,
              t.idx >= lo && t.idx <= hi && s.inRange,
              playingIdx === t.idx && s.playing,
              ev.has(t.idx) && s.evidence,
            )}
            onClick={onTurnClick ? () => onTurnClick(t.idx) : undefined}
            title={onTurnClick && offset != null ? `Перейти к ${formatSeconds(offset)} в записи` : undefined}
          >
            <Caption1 className={s.meta}>
              <span className={s.idx}>#{t.idx}</span>
              <span>{SPEAKER_LABEL[t.speaker]}</span>
              <span>{timeLabel(t.timestamp)}</span>
              {offset != null && onTurnClick ? <span>▶ {formatSeconds(offset)}</span> : null}
            </Caption1>
            <span className={s.text}>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
