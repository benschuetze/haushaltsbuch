import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { type EntryContext, type HandleErrorFunction, ServerRouter } from "react-router";
import { log } from "~/lib/observability/log.server";
import { contentSecurityPolicy, createNonce, safeError } from "~/lib/security.server";
import { NonceProvider } from "./nonce";

export const streamTimeout = 5_000;

/**
 * Every uncaught loader, action or render error ends here, also when an error boundary shows a friendly page.
 * Only the path goes along, never the query: it can contain search terms from the bookings.
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  // A user who navigates away aborts the request; that is not a bug.
  if (request.signal.aborted) return;
  log.error(
    { event: "request_failed", path: new URL(request.url).pathname, err: safeError(error) },
    "Anfrage fehlgeschlagen",
  );
};

/** Like the default entry, plus a fresh CSP nonce per response that reaches every inline script. */
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const nonce = createNonce();
  if (process.env.NODE_ENV === "production") {
    responseHeaders.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  }
  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    const readyOption = (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
    const { pipe, abort } = renderToPipeableStream(
      createElement(
        NonceProvider,
        { value: nonce },
        createElement(ServerRouter, { context: routerContext, url: request.url, nonce }),
      ),
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough();
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) log.error({ event: "render_failed", err: safeError(error) }, "Rendern fehlgeschlagen");
        },
      },
    );
    setTimeout(abort, streamTimeout + 1000);
  });
}
