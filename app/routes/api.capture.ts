import { handleCapture } from "~/lib/capture/handler.server";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import type { Route } from "./+types/api.capture";

/** Resource route for the quick capture (iOS Shortcut). All logic and the token check live in handleCapture. */
export async function action({ request }: Route.ActionArgs) {
  return handleCapture(request, { db: getDb(), model: getModel() });
}
