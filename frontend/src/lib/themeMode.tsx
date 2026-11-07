import {
  FluentProvider,
  makeStyles,
  mergeClasses,
  type ButtonState,
  type FluentProviderCustomStyleHooks,
  type ToggleButtonState,
} from "@fluentui/react-components";
import { useEffect, type ReactNode } from "react";
import { ON_GREEN, appTheme } from "../theme";

// Dark text only on the green primary buttons. Badges and other "on brand" text
// keep white, which they need on red / dark-green backgrounds.
const usePrimaryText = makeStyles({
  root: { color: ON_GREEN, ":hover": { color: ON_GREEN }, ":hover:active": { color: ON_GREEN } },
});

function usePrimaryButton(state: ButtonState | ToggleButtonState) {
  const s = usePrimaryText();
  if (state.appearance === "primary" && !state.disabled && !state.disabledFocusable) {
    state.root.className = mergeClasses(state.root.className, s.root);
  }
}

const styleHooks: FluentProviderCustomStyleHooks = {
  useButtonStyles_unstable: usePrimaryButton as FluentProviderCustomStyleHooks["useButtonStyles_unstable"],
  useToggleButtonStyles_unstable: usePrimaryButton as FluentProviderCustomStyleHooks["useToggleButtonStyles_unstable"],
};

/** The app's single light theme with the soft Freedom green. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.body.style.backgroundColor = appTheme.colorNeutralBackground2;
    document.documentElement.style.colorScheme = "light";
  }, []);

  return (
    <FluentProvider
      theme={appTheme}
      customStyleHooks_unstable={styleHooks}
      style={{ minHeight: "100vh", backgroundColor: appTheme.colorNeutralBackground2 }}
    >
      {children}
    </FluentProvider>
  );
}
