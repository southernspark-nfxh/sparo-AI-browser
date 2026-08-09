/**
 * Preload for page WebContentsView.
 * Phase 1 keeps page sandbox strict; automation runs via executeJavaScript from main.
 * This file exists so Electron has a preload entry and we can extend later.
 */
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("sparkPage", {
  version: "0.1.0",
});
