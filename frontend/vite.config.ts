import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const backendUrl = env.VITE_API_URL || 'http://localhost:8000';

    return {
        server: {
            port: 3000,
            allowedHosts: true,
            proxy: {
                '/api': {
                    target: backendUrl,
                    changeOrigin: true,
                },
                '/evidence': {
                    target: backendUrl,
                    changeOrigin: true,
                },
            },
        },
        resolve: {
            alias: {
                '@': '/src',
            },
        },
        define: {
            // Make backend URL available at runtime for production
            '__API_URL__': JSON.stringify(env.VITE_API_URL || ''),
            '__SUPABASE_URL__': JSON.stringify(env.VITE_SUPABASE_URL || ''),
            '__SUPABASE_PUBLISHABLE_KEY__': JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY || ''),
        },
    };
});
