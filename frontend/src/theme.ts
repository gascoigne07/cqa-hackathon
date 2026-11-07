import { createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

/**
 * Light theme with a soft Freedom-style green. Darker shades are for text and
 * links (5.9:1 on white); the light main green is for buttons and accents.
 */
export const freedomBrand: BrandVariants = {
  10: "#0b1912",
  20: "#11271c",
  30: "#163626",
  40: "#1d4933",
  50: "#225d40",
  60: "#28714d",
  70: "#318c5e",
  80: "#4cbd85",
  90: "#60c794",
  100: "#75d1a3",
  110: "#8fdcb5",
  120: "#a9e5c7",
  130: "#bfedd6",
  140: "#d3f3e3",
  150: "#e2f8ed",
  160: "#eefbf5",
};

/** Main accent: buttons, selected tab, checkboxes. */
export const BRAND_GREEN = freedomBrand[80];
/** Green for text on white (logo mark, links). */
export const BRAND_TEXT = freedomBrand[60];
/** Text on green buttons: dark reads at ~7:1, white only at ~2.4:1. */
export const ON_GREEN = "#0b2416";

const base = createLightTheme(freedomBrand);

export const appTheme: Theme = {
  ...base,
  colorBrandBackground: freedomBrand[80],
  colorBrandBackgroundHover: freedomBrand[90],
  colorBrandBackgroundPressed: freedomBrand[70],
  colorBrandBackgroundSelected: freedomBrand[90],
  colorCompoundBrandBackground: freedomBrand[80],
  colorCompoundBrandBackgroundHover: freedomBrand[90],
  colorCompoundBrandBackgroundPressed: freedomBrand[70],
  colorCompoundBrandForeground1: freedomBrand[70],
  colorCompoundBrandStroke: freedomBrand[80],
  colorBrandStroke1: freedomBrand[80],
  colorBrandForeground1: freedomBrand[60],
  colorBrandForeground2: freedomBrand[50],
  colorBrandForegroundLink: freedomBrand[60],
  colorBrandForegroundLinkHover: freedomBrand[50],
  colorBrandForegroundLinkPressed: freedomBrand[40],
  colorBrandBackground2: freedomBrand[160],
  colorNeutralForegroundInverted: ON_GREEN, // checkmarks and switch thumbs on green
  colorNeutralBackground2: "#f5f7f6",
  colorNeutralBackground3: "#eef1ef",
};
