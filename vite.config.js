import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node', // We use 'node' because we mock the DOM APIs manually in the tests
    globals: true,
  },
  server: {
    host: true, // Allows accessing the dev server from your phone on the same Wi-Fi
    port: 8080,
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'] // Prevents Vite from breaking the ONNX WASM files
  }
});