import { Tab, TabList, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ChatMultipleRegular, DataBarHorizontalRegular, GavelRegular, TaskListLtrRegular } from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api/cqa";
import { ProviderToggle } from "./components/ProviderToggle";
import { ProviderProvider } from "./lib/provider";
import { navigate, useRoute } from "./router";
import { AccuracyScreen } from "./screens/AccuracyScreen";
import { AppealsScreen } from "./screens/AppealsScreen";
import { ChecklistScreen } from "./screens/ChecklistScreen";
import { DialogsScreen } from "./screens/DialogsScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { BRAND_GREEN, BRAND_TEXT } from "./theme";

const useStyles = makeStyles({
  shell: { minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground2 },
  header: {
    position: "sticky",
    top: "0",
    zIndex: 10,
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `3px solid ${BRAND_GREEN}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
  },
  bar: {
    display: "flex",
    alignItems: "center",
    columnGap: "20px",
    rowGap: "6px",
    padding: "6px 20px",
    minHeight: "54px",
    flexWrap: "wrap",
    maxWidth: "1520px",
    margin: "0 auto",
    boxSizing: "border-box",
  },
  brand: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
  logoImg: { height: "28px", maxWidth: "180px", objectFit: "contain", display: "block" },
  mark: {
    fontWeight: tokens.fontWeightBold,
    fontSize: "20px",
    letterSpacing: "0.04em",
    color: BRAND_TEXT,
  },
  sub: { display: "flex", flexDirection: "column", lineHeight: "1.15" },
  subTitle: { color: tokens.colorNeutralForeground1 },
  subNote: { color: tokens.colorNeutralForeground3 },
  grow: { flexGrow: 1 },
  tabs: { maxWidth: "100%", overflowX: "auto", scrollbarWidth: "none", "::-webkit-scrollbar": { display: "none" } },
  main: { padding: "20px", maxWidth: "1520px", width: "100%", margin: "0 auto", boxSizing: "border-box" },
});

function Brand() {
  const s = useStyles();
  const q = useQuery({ queryKey: ["branding"], queryFn: api.branding, staleTime: 60_000 });
  const [broken, setBroken] = useState(false);
  const logo = q.data?.logo_url && !broken ? api.mediaUrl(q.data.logo_url) : null;
  return (
    <div className={s.brand}>
      {logo ? <img className={s.logoImg} src={logo} alt="Логотип" onError={() => setBroken(true)} /> : null}
      <span className={s.mark}>CQA</span>
      <span className={s.sub}>
        <Text size={200} className={s.subTitle}>
          Оценка качества диалогов
        </Text>
        <Text size={100} className={s.subNote}>
          для Freedom Broker
        </Text>
      </span>
    </div>
  );
}

function Shell() {
  const s = useStyles();
  const route = useRoute();
  const openAppeals = useQuery({ queryKey: ["appeals", "open"], queryFn: () => api.appeals("open"), retry: false });
  const tab = route.name === "dialog" ? "dialogs" : route.name;

  return (
    <div className={s.shell}>
      <div className={s.header}>
        <header className={s.bar}>
          <Brand />
          <div className={s.tabs}>
            <TabList selectedValue={tab} onTabSelect={(_, d) => navigate({ name: d.value as "dialogs" | "checklist" | "appeals" | "accuracy" })}>
              <Tab value="dialogs" icon={<ChatMultipleRegular />}>
                Диалоги
              </Tab>
              <Tab value="checklist" icon={<TaskListLtrRegular />}>
                Чек-лист
              </Tab>
              <Tab value="appeals" icon={<GavelRegular />}>
                Апелляции{openAppeals.data?.length ? ` (${openAppeals.data.length})` : ""}
              </Tab>
              <Tab value="accuracy" icon={<DataBarHorizontalRegular />}>
                Точность
              </Tab>
            </TabList>
          </div>
          <span className={s.grow} />
          <ProviderToggle />
        </header>
      </div>
      <main className={s.main}>
        {route.name === "dialogs" && <DialogsScreen />}
        {route.name === "dialog" && <ResultScreen key={route.id} dialogId={route.id} />}
        {route.name === "checklist" && <ChecklistScreen />}
        {route.name === "appeals" && <AppealsScreen appealId={route.id} />}
        {route.name === "accuracy" && <AccuracyScreen />}
      </main>
    </div>
  );
}

export function App() {
  return (
    <ProviderProvider>
      <Shell />
    </ProviderProvider>
  );
}
