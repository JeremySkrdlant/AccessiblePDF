/// <reference types="vite/client" />

// Allow ?url imports for web workers
declare module '*?url' {
  const src: string
  export default src
}
