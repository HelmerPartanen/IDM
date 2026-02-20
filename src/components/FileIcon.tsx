import React, { useEffect, useState } from 'react';
import {
  Archive, AppWindow, FileText, Video, Music, Image, Disc, File,
  type LucideIcon
} from 'lucide-react';

/** Lucide fallback icons by file category */
const categoryIcons: Record<string, LucideIcon> = {
  archive: Archive,
  app: AppWindow,
  doc: FileText,
  video: Video,
  audio: Music,
  image: Image,
  disc: Disc,
  file: File,
};

const extToCategory: Record<string, string> = {
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  exe: 'app', msi: 'app', dmg: 'app',
  pdf: 'doc', doc: 'doc', docx: 'doc', xls: 'doc', xlsx: 'doc', txt: 'doc',
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video',
  mp3: 'audio', flac: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', svg: 'image', webp: 'image',
  iso: 'disc', img: 'disc',
};

function getFallbackIcon(filename: string): LucideIcon {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.substring(dot + 1).toLowerCase() : '';
  const cat = extToCategory[ext] || 'file';
  return categoryIcons[cat] || File;
}

/** Favicon cache keyed by domain */
const faviconCache = new Map<string, string>();
const faviconPending = new Map<string, Promise<string | null>>();

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function fetchFavicon(domain: string): Promise<string | null> {
  if (faviconCache.has(domain)) return faviconCache.get(domain)!;
  if (faviconPending.has(domain)) return faviconPending.get(domain)!;

  const promise = window.api.getFavicon(domain).then((dataUrl) => {
    if (dataUrl) faviconCache.set(domain, dataUrl);
    faviconPending.delete(domain);
    return dataUrl;
  }).catch(() => {
    faviconPending.delete(domain);
    return null;
  });

  faviconPending.set(domain, promise);
  return promise;
}

interface FileIconProps {
  filename: string;
  /** The download URL — used to fetch the source site's favicon */
  url?: string;
  size?: number;
  className?: string;
}

export function FileIcon({ filename, url = '', size = 24, className = '' }: FileIconProps) {
  const [faviconUrl, setFaviconUrl] = useState<string | null>(() => {
    const domain = getDomain(url);
    return domain ? (faviconCache.get(domain) ?? null) : null;
  });
  const [faviconFailed, setFaviconFailed] = useState(false);

  // Fetch the source site's favicon
  useEffect(() => {
    let cancelled = false;
    setFaviconFailed(false);

    const domain = getDomain(url);
    if (!domain) return;

    fetchFavicon(domain).then((dataUrl) => {
      if (!cancelled) {
        if (dataUrl) setFaviconUrl(dataUrl);
        else setFaviconFailed(true);
      }
    });

    return () => { cancelled = true; };
  }, [url]);

  const hasFavicon = faviconUrl && !faviconFailed;

  if (hasFavicon) {
    return (
      <img
        src={faviconUrl}
        alt=""
        width={size}
        height={size}
        className={`object-contain rounded-sm ${className}`}
        draggable={false}
        onError={() => setFaviconFailed(true)}
      />
    );
  }

  // Fallback: category-aware Lucide icon
  const FallbackIcon = getFallbackIcon(filename);
  return <FallbackIcon size={size * 0.65} />;
}
