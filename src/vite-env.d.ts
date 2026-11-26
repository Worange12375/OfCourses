/// <reference types="vite/client" />

declare const __APP_BUILD_ID__: string;

declare module "*.svg?raw" {
    const content: string;
    export default content;
}
