import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("admin.html", "dist/admin.html"); // 管理者頁面(發送金幣)
// 遊戲規則:瀏覽器直接載入,伺服器函式則是 import 同一份檔案
await cp("shared/game.cjs", "dist/game.js");

await build({
  entryPoints: ["src/auth.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/auth.js",
});
console.log("build ok");
