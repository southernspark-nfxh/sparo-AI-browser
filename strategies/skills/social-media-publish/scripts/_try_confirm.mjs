import { tabs, click } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com/.test(t.url || ""));
if (!tab) { console.log("NO_TAB"); process.exit(0); }
const sel = ".cheetah-ui-pro-image-modal .cheetah-modal-footer button.cheetah-btn-primary";
const raw = await click(sel, tab.id);
console.log(String(raw).slice(0, 1500));
