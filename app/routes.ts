import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("import", "routes/import.tsx"),
  route("transaktionen", "routes/transaktionen.tsx"),
  route("monat/:month", "routes/monat.tsx"),
  route("regeln", "routes/regeln.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("favicon.ico", "routes/favicon.ts"),
] satisfies RouteConfig;
