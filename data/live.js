/* ==========================================================================
   data/live.js —— 本机「在线实时试用」后端地址（由 tools/live_supervisor.py 自动重写）
   backend 为空 = 走同源相对路径（本机 127.0.0.1:8250 自访问）。
   口令不进这个文件：链接里以 ?k=… 传递，页面收到后存 localStorage。
   ========================================================================== */
window.HUB_LIVE = { backend: "https://bags-packages-cloth-monkey.trycloudflare.com" };
