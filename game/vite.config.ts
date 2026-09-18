import { defineConfig } from 'vite';

// 极简配置：固定开发端口，关闭自动打开浏览器（无头环境）
export default defineConfig({
  server: { port: 5173, open: false },
});
