import { useEffect, useState } from "react";

/**
 * Hash routing (#/dialog/p1-ru-001). Works from a single HTML file and inside
 * an iframe (Dynamics web resource), unlike History-API routing.
 */
export type Route =
  | { name: "dialogs" }
  | { name: "dialog"; id: string }
  | { name: "checklist" }
  | { name: "appeals"; id?: number }
  | { name: "accuracy" };

export function parseHash(hash: string): Route {
  const [path] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "dialog" && parts[1]) return { name: "dialog", id: parts[1] };
  if (parts[0] === "checklist") return { name: "checklist" };
  if (parts[0] === "appeals") return { name: "appeals", id: parts[1] ? Number(parts[1]) : undefined };
  if (parts[0] === "accuracy") return { name: "accuracy" };
  return { name: "dialogs" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "dialog":
      return `#/dialog/${encodeURIComponent(route.id)}`;
    case "checklist":
      return "#/checklist";
    case "appeals":
      return route.id ? `#/appeals/${route.id}` : "#/appeals";
    case "accuracy":
      return "#/accuracy";
    default:
      return "#/";
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
