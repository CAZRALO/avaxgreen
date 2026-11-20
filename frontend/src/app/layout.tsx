import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'AvaxGreen | Turn clean energy into real impact', description: 'AI verified solar energy. Traceable carbon credits. Permanent climate impact. Built for Avalanche UniHack Vietnam.' };
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="vi"><body>{children}</body></html>; }
