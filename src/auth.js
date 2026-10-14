// 建置時會被打包成 dist/auth.js,讓純 HTML 頁面也能處理驗證連結
import { handleAuthCallback } from "@netlify/identity";
window.handleAuthCallback = handleAuthCallback;
