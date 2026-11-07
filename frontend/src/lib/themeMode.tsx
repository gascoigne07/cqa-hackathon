import { FluentProvider, makeStaticStyles } from "@fluentui/react-components";
import type { ReactNode } from "react";
import "../fonts";
import { appTheme, cssVars, palette } from "../theme";

/** Global rules for non-Fluent elements: CSS variables, keyboard focus, reduced motion. */
const useGlobalStyles = makeStaticStyles({
  ":root": { ...cssVars, colorScheme: "light" },
  body: { backgroundColor: palette.paper },
  // visible keyboard focus for our own SVG / custom controls (Fluent components draw their own)
  "[data-focusable]:focus-visible": { outline: `2px solid ${palette.ink}`, outlineOffset: "2px" },
});

/** The app's single theme: recorder paper, ink, meaning-only colour. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  useGlobalStyles();
  return (
    <FluentProvider theme={appTheme} style={{ minHeight: "100vh", backgroundColor: palette.paper }}>
      {children}
    </FluentProvider>
  );
}
