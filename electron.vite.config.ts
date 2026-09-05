import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, "src/main/preload.ts"),
          "shell-preload": resolve(__dirname, "src/main/shell-preload.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    server: {
      fs: {
        allow: [resolve(__dirname, "src")],
      },
    },
    build: {
      rollupOptions: {
        input: {
          shell: resolve(__dirname, "src/renderer/shell.html"),
        },
      },
    },
  },
});
