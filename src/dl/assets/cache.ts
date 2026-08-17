/*
File Description: Implements a shared local disk and memory asset caching manager for 3D GLTF models and PBR textures.
*/

import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'public', 'assets', 'cache_3d');

// Ensures the local 3D asset cache directory exists on disk.
export function ensureCacheDir(): string {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  return CACHE_DIR;
}

// Checks if a cached 3D GLTF model or texture file exists on disk.
export function isAssetCached(filename: string): boolean {
  const filePath = path.join(ensureCacheDir(), filename);
  return fs.existsSync(filePath);
}

// Returns the public URI for a cached 3D asset file.
export function getCachedAssetUri(filename: string): string {
  return `/assets/cache_3d/${filename}`;
}
