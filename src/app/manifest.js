export default function manifest() {
  return {
    name: 'PrismGate — AI Access Platform',
    short_name: 'PrismGate',
    description: 'One prism, every model. Buy credits, mint API keys, and route Claude, GPT, Gemini and more through a single OpenAI-compatible gateway.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0716',
    theme_color: '#0B0716',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icons/icon-192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
      },
      {
        src: '/icons/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
      },
      {
        src: '/icons/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
