import { tabs, call, activeIdOf } from "./sparo.mjs";
const listed = await tabs();
const id = activeIdOf(listed);
console.log("active", id);
const raw = await call("switch_tab", { id });
console.log("switch:", String(raw).slice(0, 300));
