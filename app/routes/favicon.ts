import { redirect } from "react-router";

// Some browsers ask for /favicon.ico regardless of the <link>; without this every visit logs a 404.
export function loader() {
  return redirect("/favicon.svg", 301);
}
