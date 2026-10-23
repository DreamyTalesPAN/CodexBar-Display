import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(directory, "../../../apps/control-center");

export default {
  root: directory,
  cacheDir: path.join(directory, "out/.vite"),
  resolve: {
    alias: {
      "@": path.join(app, "src"),
      react: path.join(app, "node_modules/react"),
      "react-dom": path.join(app, "node_modules/react-dom"),
      vitest: path.join(app, "node_modules/vitest"),
    },
  },
  test: { include: ["capture-preview.test.ts"] },
};
