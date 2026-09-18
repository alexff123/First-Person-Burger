import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// 多入口：index.html = 灰盒逻辑 Demo；scene.html = Three.js + cannon-es 切土豆 Demo
export default defineConfig({
  server: { port: 5173, open: false },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        scene: fileURLToPath(new URL('scene.html', import.meta.url)),
      },
    },
  },
});
