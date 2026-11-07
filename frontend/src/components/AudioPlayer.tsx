import { Button, Caption1, Link, MessageBar, MessageBarBody, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { PauseRegular, PlayRegular } from "@fluentui/react-icons";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { formatSeconds } from "../lib/format";
import { palette } from "../theme";

const WAVE_COLORS = { waveColor: palette.grid, progressColor: palette.graphite, cursorColor: palette.ink };

export interface AudioPlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "6px" },
  bar: { display: "flex", alignItems: "center", gap: "10px" },
  wave: { flexGrow: 1, minWidth: 0 },
  time: { fontVariantNumeric: "tabular-nums", color: tokens.colorNeutralForeground3, whiteSpace: "nowrap" },
  hint: { color: tokens.colorNeutralForeground3 },
});

interface Props {
  src: string;
  originalUrl?: string | null;
  /** Called with the current position while playing (for transcript follow-along). */
  onTime?: (seconds: number, playing: boolean) => void;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, Props>(function AudioPlayer({ src, originalUrl, onTime }, ref) {
  const s = useStyles();
  const container = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useEffect(() => {
    if (!container.current) return;
    setReady(false);
    setError(null);
    const w = WaveSurfer.create({
      container: container.current,
      url: src,
      height: 44,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      ...WAVE_COLORS,
      normalize: true,
    });
    w.on("ready", () => {
      setReady(true);
      setDuration(w.getDuration());
    });
    w.on("timeupdate", (t) => {
      setTime(t);
      onTimeRef.current?.(t, w.isPlaying());
    });
    w.on("play", () => setPlaying(true));
    w.on("pause", () => {
      setPlaying(false);
      onTimeRef.current?.(w.getCurrentTime(), false);
    });
    w.on("error", (e) => setError(e instanceof Error ? e.message : "Не удалось загрузить запись"));
    ws.current = w;
    return () => {
      w.destroy();
      ws.current = null;
    };
  }, [src]);

  useImperativeHandle(ref, () => ({
    seek(seconds, play = true) {
      const w = ws.current;
      if (!w || !ready) return;
      w.setTime(Math.max(0, Math.min(seconds, w.getDuration())));
      if (play) void w.play();
    },
  }));

  return (
    <div className={s.root}>
      {error ? (
        <MessageBar intent="warning">
          <MessageBarBody>
            Запись не загрузилась ({error}).{" "}
            {originalUrl ? (
              <Link href={originalUrl} target="_blank" rel="noreferrer">
                Открыть плеер организаторов
              </Link>
            ) : null}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      <div className={s.bar}>
        <Button
          appearance="primary"
          icon={playing ? <PauseRegular /> : <PlayRegular />}
          disabled={!ready}
          onClick={() => void ws.current?.playPause()}
          aria-label={playing ? "Пауза" : "Воспроизвести"}
        />
        <div className={s.wave} ref={container} />
        {!ready && !error ? <Spinner size="tiny" label="Загрузка записи…" /> : null}
        <Caption1 className={s.time}>
          {formatSeconds(time)} / {formatSeconds(duration)}
        </Caption1>
      </div>
      <Caption1 className={s.hint}>
        Перетаскивание по ленте и клик по реплике перематывают запись. Паузы записи во время удержания вычтены.
      </Caption1>
    </div>
  );
});
