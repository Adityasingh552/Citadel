import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 3000,
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
            '/evidence': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
        },
    },
    resolve: {
        alias: {
            '@': '/src',
        },
    },
});
