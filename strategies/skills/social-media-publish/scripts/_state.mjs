import { tabs, call, authSource } from "./sparo.mjs";

try {
  console.error("auth:", authSource());
  const listed = await tabs();
  console.log(JSON.stringify(listed, null, 1));
  console.error("--- raw tools ---");
  const raw = await call("list_tabs", {});
  console.log(String(raw).slice(0, 2000));
} catch (e) {
  console.error("ERR", e && e.stack || e);
}
