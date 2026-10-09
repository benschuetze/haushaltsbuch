/** Fake Enable Banking API for E2E runs. Never used outside tests. */
import { createServer } from "node:http";
import { createFakeBank } from "../helpers/fake-bank";

const port = Number(process.env.FAKE_BANK_PORT ?? 5437);
const bank = createFakeBank({
  appId: process.env.ENABLE_BANKING_APP_ID ?? "",
  publicKey: Buffer.from(process.env.FAKE_BANK_PUBLIC_KEY ?? "", "base64").toString("utf8"),
});

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  if (req.url === "/__expire") {
    bank.state.expireSessions = true;
    res.end("ok");
    return;
  }
  if (req.url === "/__reset") {
    bank.state.expireSessions = false;
    res.end("ok");
    return;
  }
  const response = await bank.handle(
    new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    }),
  );
  res.writeHead(response.status, { "Content-Type": "application/json" });
  res.end(await response.text());
}).listen(port, "127.0.0.1", () => console.log(`Fake-Bank auf ${port}`));
