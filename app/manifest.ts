import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cutfish — Private browser video editor',
    short_name: 'Cutfish',
    description: 'Private video editing powered by WebAssembly.',
    start_url: '/',
    display: 'standalone',
    background_color: '#111113',
    theme_color: '#111113',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
