import { Tab, TabList, makeStyles } from "@fluentui/react-components";
import { ChatMultipleRegular, DataBarHorizontalRegular, GavelRegular, GridRegular, TaskListLtrRegular } from "@fluentui/react-icons";
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
import { OverviewScreen } from "./screens/OverviewScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { derived, palette, type } from "./theme";

const useStyles = makeStyles({
  shell: { minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: palette.paper },
  header: {
    position: "sticky",
    top: "0",
    zIndex: 10,
    backgroundColor: palette.paper,
    borderBottom: `1px solid ${palette.ink}`,
    // on a phone the bar wraps to three lines — let it scroll away instead of covering a fifth of the screen
    "@media (max-width: 600px)": { position: "static" },
  },
  bar: {
    display: "flex",
    alignItems: "center",
    columnGap: "20px",
    rowGap: "6px",
    padding: "6px 20px",
    minHeight: "52px",
    flexWrap: "wrap",
    maxWidth: "1520px",
    margin: "0 auto",
    boxSizing: "border-box",
    "@media (max-width: 600px)": { padding: "6px 16px" },
  },
  brand: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
  logoImg: { height: "28px", maxWidth: "180px", objectFit: "contain", display: "block" },
  mark: { fontWeight: 600, fontSize: type.lg, lineHeight: "1", color: palette.ink },
  sub: { display: "flex", flexDirection: "column", lineHeight: "1.2", fontSize: type.xs },
  subTitle: { color: palette.ink },
  subNote: { color: derived.graphiteStrong },
  grow: { flexGrow: 1 },
  // 5 tabs don't fit on a phone: scroll them sideways instead of widening the page.
  tabs: { maxWidth: "100%", overflowX: "auto", scrollbarWidth: "none", "::-webkit-scrollbar": { display: "none" } },
  main: {
    padding: "20px",
    maxWidth: "1520px",
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box",
    "@media (max-width: 600px)": { padding: "16px" },
  },
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
        <span className={s.subTitle}>Оценка качества диалогов</span>
        <span className={s.subNote}>для Freedom Broker</span>
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
            <TabList
              selectedValue={tab}
              onTabSelect={(_, d) => navigate({ name: d.value as "dialogs" | "overview" | "checklist" | "appeals" | "accuracy" })}
            >
              <Tab value="dialogs" icon={<ChatMultipleRegular />}>
                Диалоги
              </Tab>
              <Tab value="overview" icon={<GridRegular />}>
                Обзор
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
        {route.name === "dialogs" && <DialogsScreen grossOnly={!!route.gross} />}
        {route.name === "dialog" && <ResultScreen key={route.id} dialogId={route.id} focus={route.focus} />}
        {route.name === "overview" && <OverviewScreen />}
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
