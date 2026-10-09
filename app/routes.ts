import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("import", "routes/import.tsx"),
  route("transaktionen", "routes/transaktionen.tsx"),
  route("monat/:month", "routes/monat.tsx"),
  route("regeln", "routes/regeln.tsx"),
  route("konten", "routes/konten.tsx"),
  route("budgets", "routes/budgets.tsx"),
  route("abos", "routes/abos.tsx"),
  route("hinweise", "routes/hinweise.tsx"),
  route("pruefen", "routes/pruefen.tsx"),
  route("banken", "routes/banken.tsx"),
  route("bank/callback", "routes/bank.callback.ts"),
  route("bank/sync", "routes/bank.sync.ts"),
  route("assistent", "routes/assistent.ts"),
  route("datenschutz", "routes/datenschutz.tsx"),
  route("nutzungsbedingungen", "routes/nutzungsbedingungen.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("favicon.ico", "routes/favicon.ts"),
] satisfies RouteConfig;
