import { useEffect, useState } from "react";

/**
 * Hash routing (#/dialog/p1-ru-001). Works from a single HTML file and inside
 * an iframe (Dynamics web resource), unlike History-API routing.
 */
export type Route =
  | { name: "dialogs"; gross?: boolean } // ⊕ #/?gross=1 — only dialogs with a gross error
  | { name: "dialog"; id: string; focus?: string } // ⊕ #/dialog/<id>?c=<criterion> — open scrolled to that criterion
  | { name: "overview" }
  | { name: "checklist" }
  | { name: "appeals"; id?: number }
  | { name: "accuracy" };

export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "dialog" && parts[1]) return { name: "dialog", id: parts[1], focus: params.get("c") || undefined };
  if (parts[0] === "overview") return { name: "overview" };
  if (parts[0] === "checklist") return { name: "checklist" };
  if (parts[0] === "appeals") return { name: "appeals", id: parts[1] ? Number(parts[1]) : undefined };
  if (parts[0] === "accuracy") return { name: "accuracy" };
  return { name: "dialogs", gross: params.get("gross") === "1" || undefined };
}

export function href(route: Route): string {
  switch (route.name) {
    case "dialog":
      return `#/dialog/${encodeURIComponent(route.id)}${route.focus ? `?c=${encodeURIComponent(route.focus)}` : ""}`;
    case "overview":
      return "#/overview";
    case "checklist":
      return "#/checklist";
    case "appeals":
      return route.id ? `#/appeals/${route.id}` : "#/appeals";
    case "accuracy":
      return "#/accuracy";
    default:
      return route.gross ? "#/?gross=1" : "#/";
  }
}

export const navigate = (route: Route) => {
  window.location.hash = href(route);
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
