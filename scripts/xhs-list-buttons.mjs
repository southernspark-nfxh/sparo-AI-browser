#!/usr/bin/env node
import { loadAuth, initialize, mcpCall } from "./mcp-helpers.mjs";

const auth = loadAuth();
await initialize(auth);
await mcpCall(auth, "resume", {}).catch(() => {});
const r = await mcpCall(auth, "execute", {
  script: `(() => {
    const nodes = [...document.querySelectorAll('button, [role=button], .d-button, a')];
    return nodes.map(el => {
      const t=(el.innerText||'').trim().slice(0,40);
      const box=el.getBoundingClientRect();
      return {t, cls:String(el.className||'').slice(0,70), w:Math.round(box.width), h:Math.round(box.height), x:Math.round(box.x), y:Math.round(box.y)};
    }).filter(x => x.w>20 && x.h>16 && x.t);
  })()`,
});
console.log(JSON.stringify(r.data?.result, null, 2));
