import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            '@': '/src',
        },
    },
    // 本地联调：把后端接口代理到本地投票后端（127.0.0.1:8002），
    // 避免 CORS / Sec-Fetch-Site 跨站拦截；生产环境 nginx 反代同名路径，行为一致。
    server: {
        proxy: {
            '/vote': 'http://127.0.0.1:8002',
            '/track': 'http://127.0.0.1:8002',
        },
    },
})
