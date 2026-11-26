import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const buildId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)

export default defineConfig({
    define: {
        __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [
        react(),
        tailwindcss(),
        {
            name: 'emit-app-build-version',
            generateBundle() {
                this.emitFile({
                    type: 'asset',
                    fileName: 'version.json',
                    source: JSON.stringify({version: buildId}),
                })
            },
        },
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
