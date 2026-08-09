#!/usr/bin/env node
import { loadAuth, initialize, mcpCall } from "./mcp-helpers.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "_spark_upload_probe.png");

const auth = loadAuth();
await initialize(auth);

const up = await mcpCall(auth, "upload", {
  ref: "e484",
  files: [file],
});
console.log("UPLOAD", JSON.stringify(up, null, 2).slice(0, 800));

const check = await mcpCall(auth, "execute", {
  script: `(() => {
    const el = document.querySelector('#localFileUploadInp') || document.querySelector('input[type=file]');
    if (!el) return { ok: false };
    return {
      ok: true,
      files: el.files ? el.files.length : 0,
      name0: el.files && el.files[0] ? el.files[0].name : null,
    };
  })()`,
});
console.log("FILE_INPUT_STATE", JSON.stringify(check));
