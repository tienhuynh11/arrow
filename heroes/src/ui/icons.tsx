// Icon SVG vẽ tay (KHÔNG dùng emoji). viewBox 24x24, viền mực đậm kiểu hoạt hình.
import type { JSX } from 'preact';
import type { Element, Role } from '@shared/heroes/types';

const INK = '#1e2a4a';
const st: any = { stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

type IconName =
  | 'gold' | 'gem' | 'ticket' | 'exp' | 'stone' | 'bolt' | 'star' | 'starEmpty' | 'home' | 'heroes' | 'squad' | 'summon'
  | 'battle' | 'gear' | 'back' | 'lock' | 'close' | 'check' | 'pause' | 'play' | 'ffwd' | 'auto' | 'sword' | 'shield' | 'heart'
  | 'clock' | 'up' | 'down' | 'leaf' | 'rock' | 'drop' | 'sun' | 'moon' | 'wand' | 'bow' | 'plus' | 'note' | 'crown'
  | 'sparkle' | 'logout' | 'info' | 'chest' | 'skip' | 'user' | 'sound' | 'mute' | 'filter' | 'search'
  | 'gWeapon' | 'gArmor' | 'gHelmet' | 'gAccessory' | 'bag' | 'tower' | 'quest' | 'shop' | 'grid' | 'arena'
  | 'events' | 'guild' | 'boss' | 'chat';

const PATHS: Record<IconName, JSX.Element> = {
  gold: (
    <>
      <circle cx="12" cy="12" r="9" fill="#ffcb2e" {...st} />
      <circle cx="12" cy="12" r="5.4" fill="#ffe27a" stroke="#d98a00" stroke-width="1.5" />
      <path d="M12 9v6M10 10.5h3a1 1 0 0 1 0 2h-2a1 1 0 0 0 0 2h3" fill="none" stroke="#d98a00" stroke-width="1.4" stroke-linecap="round" />
    </>
  ),
  gem: (
    <>
      <path d="M12 3 L20 9 L12 21 L4 9 Z" fill="#4fd3ff" {...st} />
      <path d="M4 9h16M9 9l3-6 3 6M9 9l3 12 3-12" fill="none" stroke={INK} stroke-width="1.2" stroke-linejoin="round" />
      <path d="M7.5 8.4l2-3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" fill="#ff7ab0" {...st} />
      <path d="M9 7v10" stroke="#fff" stroke-width="1.4" stroke-dasharray="2 2" />
      <path d="M15 9.2l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#ffe27a" stroke={INK} stroke-width=".8" stroke-linejoin="round" />
    </>
  ),
  exp: (
    <>
      <path d="M9 3h6v5l4.2 8.4A3 3 0 0 1 16.5 21h-9a3 3 0 0 1-2.7-4.6L9 8z" fill="#c7e3ff" {...st} />
      <path d="M6.4 15h11.2l1.1 2.2A2 2 0 0 1 17 20H7a2 2 0 0 1-1.7-2.8z" fill="#b66cff" stroke={INK} stroke-width="1.2" stroke-linejoin="round" />
      <path d="M8.5 3h7" stroke={INK} stroke-width="2.2" stroke-linecap="round" />
    </>
  ),
  stone: (
    <>
      <path d="M12 2.5 L19 7 V15 L12 21.5 L5 15 V7 Z" fill="#9db2d6" {...st} />
      <path d="M5 7l7 4 7-4M12 11v10.5" fill="none" stroke={INK} stroke-width="1.2" stroke-linejoin="round" />
      <path d="M8 6.5l2-1.3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
    </>
  ),
  bolt: <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" fill="#7be34a" {...st} />,
  star: <path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4L2.7 9.5l6.5-.7z" fill="#ffd23f" {...st} />,
  starEmpty: <path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4L2.7 9.5l6.5-.7z" fill="#cfd8ea" {...st} />,
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" fill="none" {...st} />
      <path d="M5.5 10.5V20h13v-9.5L12 5z" fill="#ffd9a0" {...st} />
      <rect x="10" y="13.5" width="4" height="6.5" rx="1" fill="#e2583e" stroke={INK} stroke-width="1.4" />
    </>
  ),
  heroes: (
    <>
      <path d="M5 14a7 7 0 0 1 14 0v5H5z" fill="#8fb5ff" {...st} />
      <path d="M12 4v5M8.5 13h7v3h-7z" fill="#ffd23f" stroke={INK} stroke-width="1.4" stroke-linejoin="round" />
    </>
  ),
  squad: (
    <>
      <circle cx="8" cy="8" r="3.2" fill="#ffd9b8" {...st} />
      <circle cx="16.5" cy="9" r="2.8" fill="#ffd9b8" {...st} />
      <path d="M2.5 20c0-4 2.4-6.2 5.5-6.2s5.5 2.2 5.5 6.2z" fill="#5ec0ff" {...st} />
      <path d="M14 14.4c.8-.4 1.6-.6 2.5-.6 2.8 0 5 2 5 5.2h-6" fill="#ff9a1f" {...st} />
    </>
  ),
  summon: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.5" fill="#b78cff" {...st} />
      <path d="M12 7.5l1.5 3.3 3.5.4-2.6 2.4.7 3.5-3.1-1.8-3.1 1.8.7-3.5L7 11.2l3.5-.4z" fill="#fff3a0" stroke={INK} stroke-width="1.2" stroke-linejoin="round" />
    </>
  ),
  battle: (
    <>
      <path d="M4 4l9 9M20 4l-9 9" fill="none" stroke={INK} stroke-width="5" stroke-linecap="round" />
      <path d="M4 4l9 9M20 4l-9 9" fill="none" stroke="#e8eef8" stroke-width="2.6" stroke-linecap="round" />
      <path d="M12.5 13.5l-3 3M11.5 13.5l3 3M8 17.5l-2.5 2.5M16 17.5l2.5 2.5" fill="none" stroke={INK} stroke-width="3" stroke-linecap="round" />
      <path d="M8 17.5l-2.5 2.5M16 17.5l2.5 2.5" fill="none" stroke="#ff9a1f" stroke-width="1.4" stroke-linecap="round" />
    </>
  ),
  gear: (
    <>
      <path d="M10.2 2.5h3.6l.5 2.6 1.6.7 2.2-1.5 2.5 2.5-1.5 2.2.7 1.6 2.6.5v3.6l-2.6.5-.7 1.6 1.5 2.2-2.5 2.5-2.2-1.5-1.6.7-.5 2.6h-3.6l-.5-2.6-1.6-.7-2.2 1.5-2.5-2.5 1.5-2.2-.7-1.6-2.6-.5v-3.6l2.6-.5.7-1.6-1.5-2.2 2.5-2.5 2.2 1.5 1.6-.7z" fill="#c9d3e6" {...st} />
      <circle cx="12" cy="12" r="3.2" fill="#fff" {...st} />
    </>
  ),
  back: <path d="M15 4 7 12l8 8" fill="none" stroke={INK} stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />,
  lock: (
    <>
      <path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" fill="none" {...st} />
      <rect x="5" y="10" width="14" height="10.5" rx="2.5" fill="#ffc94d" {...st} />
      <circle cx="12" cy="15" r="1.6" fill={INK} />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" fill="none" stroke={INK} stroke-width="3.2" stroke-linecap="round" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke={INK} stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1.2" fill="#fff" {...st} />
      <rect x="14" y="5" width="4" height="14" rx="1.2" fill="#fff" {...st} />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" fill="#fff" {...st} />,
  ffwd: (
    <>
      <path d="M3.5 5.5v13l8-6.5z" fill="#fff" {...st} />
      <path d="M12.5 5.5v13l8-6.5z" fill="#fff" {...st} />
    </>
  ),
  auto: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" fill="none" stroke={INK} stroke-width="3" stroke-linecap="round" />
      <path d="M19.5 3.5v5h-5" fill="none" stroke={INK} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </>
  ),
  sword: (
    <>
      <path d="M19 3l2 2-9.5 9.5-2.5-2z" fill="#e8eef8" {...st} />
      <path d="M7.5 12.5l4 4M6 18l-3 3M6.5 14.5l3 3" fill="none" {...st} />
      <path d="M7.2 16.8L4 20" stroke="#ff9a1f" stroke-width="2.4" stroke-linecap="round" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 4.7-3.4 7.7-8 9.5C7.4 19.7 4 16.7 4 12V6z" fill="#8fb5ff" {...st} />,
  heart: <path d="M12 20.5C5 15.5 3 12 3 8.8A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 9 2.2c0 3.2-2 6.7-9 11.7z" fill="#ff5c7a" {...st} />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" fill="#fff" {...st} />
      <path d="M12 6.5V12l3.5 2" fill="none" {...st} />
    </>
  ),
  up: <path d="M12 4l7 8h-4.5v8h-5v-8H5z" fill="#ff7a1a" {...st} />,
  down: <path d="M12 20l7-8h-4.5V4h-5v8H5z" fill="#7b8cb0" {...st} />,
  leaf: (
    <>
      <path d="M4 20C4 10 9 4 20 4c0 11-6 16-14 16" fill="#54c74a" {...st} />
      <path d="M4 20 14 10" stroke={INK} stroke-width="1.4" stroke-linecap="round" fill="none" />
    </>
  ),
  rock: <path d="M3 18 7 7l5-3 6 4 3 10z" fill="#d9a050" {...st} />,
  drop: <path d="M12 3C8 9 5.5 12 5.5 15.5a6.5 6.5 0 0 0 13 0C18.5 12 16 9 12 3z" fill="#3fa7ff" {...st} />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" fill="#ffe66b" {...st} />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2 2M16.7 16.7l2 2M5.3 18.7l2-2M16.7 7.3l2-2" stroke={INK} stroke-width="2" stroke-linecap="round" />
    </>
  ),
  moon: <path d="M19 14.5A8 8 0 0 1 9.5 5 8 8 0 1 0 19 14.5z" fill="#b066ff" {...st} />,
  wand: (
    <>
      <path d="M5 19 15 9" stroke={INK} stroke-width="4.6" stroke-linecap="round" />
      <path d="M5 19 15 9" stroke="#c4864a" stroke-width="2.4" stroke-linecap="round" />
      <path d="M17 3l1 2.5 2.5 1-2.5 1L17 10l-1-2.5-2.5-1 2.5-1z" fill="#ffe66b" stroke={INK} stroke-width="1.2" stroke-linejoin="round" />
    </>
  ),
  bow: (
    <>
      <path d="M6 3c9 2 13 8 13 9s-4 7-13 9" fill="none" stroke={INK} stroke-width="4.4" stroke-linecap="round" />
      <path d="M6 3c9 2 13 8 13 9s-4 7-13 9" fill="none" stroke="#c4864a" stroke-width="2.2" stroke-linecap="round" />
      <path d="M6 3v18M4 12h13" stroke={INK} stroke-width="1.3" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" fill="#dff3ff" {...st} />
      <path d="M14.5 14.5 20 20" fill="none" {...st} />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4z" fill="#ffd23f" {...st} />,
  plus: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="#5ee08a" {...st} />,
  note: (
    <>
      <path d="M9 17V5l10-2v12" fill="none" {...st} />
      <ellipse cx="7" cy="17.5" rx="3" ry="2.3" fill="#ff9fb2" {...st} />
      <ellipse cx="17" cy="15.5" rx="3" ry="2.3" fill="#ff9fb2" {...st} />
    </>
  ),
  crown: <path d="M3 18 4.5 7l5 5L12 5l2.5 7 5-5L21 18z" fill="#ffd23f" {...st} />,
  sparkle: <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" fill="#fff3a0" {...st} />,
  logout: (
    <>
      <path d="M9 4H5v16h4M15 8l5 4-5 4M20 12H9" fill="none" {...st} />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" fill="#8fd4ff" {...st} />
      <path d="M12 11v6M12 7.5v.5" stroke={INK} stroke-width="2.4" stroke-linecap="round" />
    </>
  ),
  chest: (
    <>
      <path d="M3.5 11V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v3z" fill="#d98a3a" {...st} />
      <rect x="3.5" y="11" width="17" height="9" rx="1.5" fill="#b8692a" {...st} />
      <rect x="10" y="10" width="4" height="5" rx="1" fill="#ffd23f" stroke={INK} stroke-width="1.4" />
    </>
  ),
  skip: (
    <>
      <path d="M4 5.5v13l8-6.5z" fill="#fff" {...st} />
      <path d="M13 5.5v13l7-6.5z" fill="#fff" {...st} />
      <path d="M20.5 5v14" stroke={INK} stroke-width="2.4" stroke-linecap="round" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" fill="#ffd9b8" {...st} />
      <path d="M4 21c0-4.5 3.4-7 8-7s8 2.500 8 7z" fill="#5ec0ff" {...st} />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="#fff" {...st} />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.500 7.500 0 0 1 0 11" fill="none" {...st} />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="#fff" {...st} />
      <path d="M16 9.500l5 5M21 9.500l-5 5" fill="none" {...st} />
    </>
  ),
  gWeapon: (
    <>
      <path d="M20.5 3.5h-5L7 12l5 5 8.5-8.500z" fill="#e4edf9" {...st} />
      <path d="M10 10l4 4" stroke="#9db2d6" stroke-width="1.4" stroke-linecap="round" />
      <path d="M5 11l8 8" stroke={INK} stroke-width="4" stroke-linecap="round" />
      <path d="M5 11l8 8" stroke="#ffb52e" stroke-width="1.8" stroke-linecap="round" />
      <path d="M6.500 17.500l-3 3" stroke={INK} stroke-width="3.600" stroke-linecap="round" />
      <path d="M6.500 17.500l-3 3" stroke="#b5733a" stroke-width="1.600" stroke-linecap="round" />
    </>
  ),
  gArmor: (
    <>
      <path d="M8.500 3 3 6.500l1.800 4.500L7.500 10v10.500h9V10l2.700 1L21 6.500 15.500 3C14.500 5 13.300 5.600 12 5.600S9.500 5 8.500 3z" fill="#8fb5ff" {...st} />
      <path d="M12 8.500v12M9.500 13h5" stroke={INK} stroke-width="1.300" stroke-linecap="round" fill="none" />
      <path d="M9.200 5.800l-1.800 1.600" stroke="#fff" stroke-width="1.500" stroke-linecap="round" />
    </>
  ),
  gHelmet: (
    <>
      <path d="M12 2.500c1.200 1 1.800 2 1.800 3.200" fill="none" stroke="#ff5c6c" stroke-width="2.600" stroke-linecap="round" />
      <path d="M4 17v-5a8 8 0 0 1 16 0v5z" fill="#c9d3e6" {...st} />
      <path d="M4 14.500h16v3.500H4z" fill="#8a9bbd" {...st} />
      <path d="M12 8v6.500" stroke={INK} stroke-width="1.600" stroke-linecap="round" />
      <path d="M7.500 9.500a5.500 5.500 0 0 1 3-2.800" stroke="#fff" stroke-width="1.600" stroke-linecap="round" fill="none" />
    </>
  ),
  gAccessory: (
    <>
      <circle cx="12" cy="14.500" r="6" fill="none" stroke={INK} stroke-width="5" />
      <circle cx="12" cy="14.500" r="6" fill="none" stroke="#ffcb2e" stroke-width="2.400" />
      <path d="M12 2.500l3.200 3.200L12 9.500 8.800 5.700z" fill="#4fd3ff" {...st} />
    </>
  ),
  bag: (
    <>
      <path d="M8.500 6V4.500A1.500 1.500 0 0 1 10 3h4a1.500 1.500 0 0 1 1.500 1.500V6" fill="none" {...st} />
      <path d="M5 8.500A3 3 0 0 1 8 6h8a3 3 0 0 1 3 2.500L20 19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="#d79a5b" {...st} />
      <path d="M8 13h8v3.500H8z" fill="#f2c88f" stroke={INK} stroke-width="1.400" stroke-linejoin="round" />
      <path d="M12 12v2.500" stroke={INK} stroke-width="1.600" stroke-linecap="round" />
    </>
  ),
  tower: (
    <>
      <path d="M6 9V3.5h2.6V6h2V3.5h2.8V6h2V3.5H18V9z" fill="#9db2d6" {...st} />
      <path d="M7 9h10v12H7z" fill="#c9d3e6" {...st} />
      <path d="M10.2 21v-4a1.8 1.8 0 0 1 3.6 0v4" fill="#8a4ee0" stroke={INK} stroke-width="1.4" stroke-linejoin="round" />
      <path d="M9.5 12.2h1.6M13 12.2h1.6" stroke={INK} stroke-width="1.8" stroke-linecap="round" />
      <path d="M12 3.5V1" stroke={INK} stroke-width="1.6" stroke-linecap="round" />
      <path d="M12 1.2h4l-1.2 1.2L16 3.6h-4z" fill="#ff5c6c" stroke={INK} stroke-width="1" stroke-linejoin="round" />
    </>
  ),
  quest: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2.5" fill="#fff3c4" {...st} />
      <path d="M8 8.2l1.3 1.3 2.2-2.4M8 14l1.3 1.3 2.2-2.4" fill="none" stroke="#35b84a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M13.5 8.5h3M13.5 14.3h3" stroke={INK} stroke-width="1.8" stroke-linecap="round" />
    </>
  ),
  shop: (
    <>
      <path d="M4.5 10.5V20h15v-9.5" fill="#ffd9a0" {...st} />
      <path d="M3 10 4.8 4h14.4L21 10z" fill="#ff7a7a" {...st} />
      <path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" fill="#fff" stroke={INK} stroke-width="1.8" stroke-linejoin="round" />
      <rect x="9.5" y="14" width="5" height="6" rx="1" fill="#3fa7ff" stroke={INK} stroke-width="1.4" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" fill="#7fd4ff" {...st} />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="2" fill="#ffd23f" {...st} />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="2" fill="#8be85c" {...st} />
      <rect x="13" y="13" width="7.5" height="7.5" rx="2" fill="#ff8a8a" {...st} />
    </>
  ),
  arena: (
    <>
      <path d="M12 2.800l8 2.800v6.200c0 4.600-3.300 7.800-8 9.700-4.700-1.900-8-5.100-8-9.700V5.600z" fill="#8a4ee0" {...st} />
      <path d="M12 5.200l5.200 1.900v4.300c0 3-2.100 5.200-5.200 6.600-3.100-1.400-5.200-3.600-5.200-6.600V7.100z" fill="#b78cff" stroke={INK} stroke-width="1.100" stroke-linejoin="round" />
      <path d="M7.800 7.800l8.400 8.400M16.200 7.800l-8.400 8.400" fill="none" stroke={INK} stroke-width="3.600" stroke-linecap="round" />
      <path d="M7.800 7.800l8.400 8.400M16.200 7.800l-8.400 8.400" fill="none" stroke="#f4f8ff" stroke-width="1.800" stroke-linecap="round" />
      <path d="M6.800 9.300l1.500-1.500M17.200 9.300l-1.500-1.500" stroke="#ffcb2e" stroke-width="1.800" stroke-linecap="round" />
    </>
  ),
  events: (
    <>
      <path d="M4 10.500h16V20.500H4z" fill="#ff7a7a" {...st} />
      <path d="M3 7h18v3.500H3z" fill="#ffa8a8" {...st} />
      <path d="M12 7v13.500" stroke="#ffd23f" stroke-width="3.200" />
      <path d="M12 7v13.500" stroke={INK} stroke-width=".8" />
      <path d="M12 7C8.500 7 7.200 3.200 9.800 3.200S12 5.800 12 7zM12 7c3.500 0 4.800-3.800 2.200-3.800S12 5.800 12 7z" fill="#ffd23f" {...st} />
    </>
  ),
  guild: (
    <>
      <path d="M4 3.500h16v9c0 4-3.500 6.500-8 8.500-4.500-2-8-4.500-8-8.500z" fill="#3fa7ff" {...st} />
      <path d="M6.500 5.800h11v6.400c0 2.800-2.500 4.700-5.500 6.100-3-1.400-5.500-3.300-5.500-6.100z" fill="#7fd4ff" stroke={INK} stroke-width="1.100" stroke-linejoin="round" />
      <path d="M12 7.300l1.400 2.900 3.100.4-2.300 2.100.6 3.100-2.800-1.600-2.800 1.600.6-3.100-2.300-2.100 3.100-.4z" fill="#ffd23f" stroke={INK} stroke-width="1" stroke-linejoin="round" />
    </>
  ),
  boss: (
    <>
      <path d="M5.500 9.500L3 2.500l5.500 3.500M18.500 9.500L21 2.500 15.500 6" fill="#ffe27a" {...st} />
      <path d="M12 5c5 0 8 3 8 7.500S17 20.500 12 20.500 4 17 4 12.500 7 5 12 5z" fill="#ff7a5a" {...st} />
      <path d="M7 10.500l3.500 1.800M17 10.500l-3.500 1.800" stroke={INK} stroke-width="2.200" stroke-linecap="round" />
      <circle cx="9.200" cy="13" r="1.200" fill="#fff" stroke={INK} stroke-width="1" />
      <circle cx="14.800" cy="13" r="1.200" fill="#fff" stroke={INK} stroke-width="1" />
      <path d="M8 16.500l1.600 2.800 1.600-2.800M12.800 16.500l1.600 2.800 1.600-2.800" fill="#fff" stroke={INK} stroke-width="1.200" stroke-linejoin="round" />
    </>
  ),
  chat: (
    <>
      <path d="M4 4.500h16a1.500 1.500 0 0 1 1.500 1.500v9a1.500 1.500 0 0 1-1.500 1.500h-8l-5 4v-4H4A1.500 1.500 0 0 1 2.500 15V6A1.500 1.500 0 0 1 4 4.500z" fill="#fff" {...st} />
      <circle cx="8" cy="10.500" r="1.400" fill={INK} />
      <circle cx="12" cy="10.500" r="1.400" fill={INK} />
      <circle cx="16" cy="10.500" r="1.400" fill={INK} />
    </>
  ),
};

export function Icon({ n, size = 20, class: cls }: { n: IconName; size?: number; class?: string }) {
  return (
    <svg class={`ic ${cls ?? ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {PATHS[n]}
    </svg>
  );
}

export const ELEM_ICON: Record<Element, IconName> = { forest: 'leaf', earth: 'rock', water: 'drop', light: 'sun', dark: 'moon' };
export const ROLE_ICON: Record<Role, IconName> = { tank: 'shield', warrior: 'sword', mage: 'wand', archer: 'bow', healer: 'plus', support: 'note' };
export const ELEM_CSS: Record<Element, string> = { forest: '#54c74a', earth: '#d9a050', water: '#3fa7ff', light: '#ffd23f', dark: '#a45bff' };
import type { GearSlot } from '@shared/heroes/gear';
export const GEAR_ICON: Record<GearSlot, IconName> = { weapon: 'gWeapon', armor: 'gArmor', helmet: 'gHelmet', accessory: 'gAccessory' };
export type { IconName };

/** huy chương top 3 (1 vàng, 2 bạc, 3 đồng) */
export function Medal({ rank, size = 28 }: { rank: 1 | 2 | 3; size?: number }) {
  const c = rank === 1 ? ['#ffd23f', '#ffb52e', '#ff5c6c'] : rank === 2 ? ['#e8eef8', '#aab6cc', '#3fa7ff'] : ['#f0b27a', '#c9803f', '#4ccf5a'];
  return (
    <svg class="ic" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={`Hạng ${rank}`}>
      <path d="M7 2.500h4l1.500 6h-4zM17 2.500h-4l-1.500 6h4z" fill={c[2]} {...st} />
      <circle cx="12" cy="15" r="6.500" fill={c[0]} {...st} />
      <circle cx="12" cy="15" r="4.300" fill={c[1]} stroke={INK} stroke-width="1.100" />
      <text x="12" y="18" text-anchor="middle" font-size="9.500" font-weight="800" fill={INK} font-family="Baloo 2, system-ui, sans-serif">{rank}</text>
    </svg>
  );
}
