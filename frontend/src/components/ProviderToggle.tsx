import { Caption1, ToggleButton, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { BeakerRegular, CloudRegular, LaptopRegular } from "@fluentui/react-icons";
import type { ProviderInfo } from "../api/contract";
import { useProvider } from "../lib/provider";

const useStyles = makeStyles({
  root: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0, maxWidth: "100%" },
  label: { color: tokens.colorNeutralForeground3, "@media (max-width: 600px)": { display: "none" } },
  group: { display: "flex", gap: "2px", padding: "2px", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground3, flexWrap: "wrap" },
  button: { whiteSpace: "nowrap" },
});

const ICON = { cloud: <CloudRegular />, local: <LaptopRegular />, demo: <BeakerRegular /> } as const;

/** Always-visible provider switch: Cloud Gemini / Local Qwen3 (hybrid) + demo. */
export function ProviderToggle() {
  const s = useStyles();
  const { providers, provider, setProvider } = useProvider();
  return (
    <div className={s.root} role="radiogroup" aria-label="Провайдер модели">
      <Caption1 className={s.label}>Модель:</Caption1>
      <div className={s.group}>
        {providers.filter((p) => p.available || !p.optional).map((p: ProviderInfo) => {
          const button = (
            <ToggleButton
              key={p.id}
              size="small"
              className={s.button}
              appearance={provider?.id === p.id ? "primary" : "subtle"}
              checked={provider?.id === p.id}
              disabled={!p.available}
              icon={ICON[p.kind]}
              role="radio"
              aria-checked={provider?.id === p.id}
              onClick={() => setProvider(p.id)}
            >
              {p.name}
            </ToggleButton>
          );
          return p.available ? (
            button
          ) : (
            <Tooltip key={p.id} content={p.note || "Недоступен"} relationship="description">
              <span>{button}</span>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
