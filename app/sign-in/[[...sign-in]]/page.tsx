'use client';

import { SignIn } from '@clerk/nextjs';

function FractalBackground() {
  const cx = 500, cy = 500;

  const hex = (r: number, off = 0) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 3) * k + off;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(' ');

  const tri = (r: number, off = -Math.PI / 2) =>
    Array.from({ length: 3 }, (_, k) => {
      const a = (2 * Math.PI / 3) * k + off;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(' ');

  const orbitDots = Array.from({ length: 8 }, (_, k) => {
    const a = (Math.PI / 4) * k;
    const r = 160;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), delay: k * 0.9 };
  });

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'linear-gradient(135deg, #030a0a 0%, #050f10 50%, #020708 100%)' }}>
      <style>{`
        @keyframes frac-cw  { from { transform: rotate(0deg);   } to { transform: rotate(360deg);  } }
        @keyframes frac-ccw { from { transform: rotate(0deg);   } to { transform: rotate(-360deg); } }
        @keyframes frac-pulse { 0%,100% { opacity:.12; } 50% { opacity:.35; } }
        @keyframes orbit { from { transform: rotate(0deg) translateX(160px) rotate(0deg); }
                           to   { transform: rotate(360deg) translateX(160px) rotate(-360deg); } }
        .fh1 { animation: frac-cw   90s linear infinite; transform-origin: 500px 500px; }
        .fh2 { animation: frac-ccw  60s linear infinite; transform-origin: 500px 500px; }
        .fh3 { animation: frac-cw   40s linear infinite; transform-origin: 500px 500px; }
        .fh4 { animation: frac-ccw  25s linear infinite; transform-origin: 500px 500px; }
        .fh5 { animation: frac-cw   16s linear infinite; transform-origin: 500px 500px; }
        .fh6 { animation: frac-ccw  10s linear infinite; transform-origin: 500px 500px; }
        .fh7 { animation: frac-cw    6s linear infinite; transform-origin: 500px 500px; }
        .ft1 { animation: frac-cw   50s linear infinite; transform-origin: 500px 500px; }
        .ft2 { animation: frac-ccw  50s linear infinite; transform-origin: 500px 500px; }
        .ft3 { animation: frac-cw   30s linear infinite; transform-origin: 500px 500px; }
        .ft4 { animation: frac-ccw  30s linear infinite; transform-origin: 500px 500px; }
        .ft5 { animation: frac-cw   17s linear infinite; transform-origin: 500px 500px; }
        .ft6 { animation: frac-ccw  17s linear infinite; transform-origin: 500px 500px; }
        .fg  { animation: frac-pulse 8s ease-in-out infinite; }
        .fo  { animation: orbit 20s linear infinite; transform-origin: 500px 500px; }
      `}</style>

      <svg viewBox="0 0 1000 1000" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="fglow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#00f0ff" stopOpacity="0.18" />
            <stop offset="45%"  stopColor="#08565b" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="fglow2" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#00f0ff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#00f0ff" stopOpacity="0" />
          </radialGradient>
          <filter id="fblur"><feGaussianBlur stdDeviation="3" /></filter>
          <filter id="fglow-f"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>

        {/* Ambient radial glow */}
        <circle cx={cx} cy={cy} r="420" fill="url(#fglow)" className="fg" />

        {/* Hexagon rings — 7 levels */}
        <polygon className="fh1" points={hex(440)}       fill="none" stroke="#00f0ff" strokeWidth="0.6" opacity="0.13" />
        <polygon className="fh2" points={hex(380, Math.PI/6)} fill="none" stroke="#0a6b72" strokeWidth="0.8" opacity="0.17" />
        <polygon className="fh3" points={hex(310)}       fill="none" stroke="#00f0ff" strokeWidth="0.8" opacity="0.22" />
        <polygon className="fh4" points={hex(250, Math.PI/6)} fill="none" stroke="#0d8a93" strokeWidth="1.0" opacity="0.25" />
        <polygon className="fh5" points={hex(195)}       fill="none" stroke="#00f0ff" strokeWidth="1.0" opacity="0.3"  />
        <polygon className="fh6" points={hex(145, Math.PI/6)} fill="none" stroke="#00f0ff" strokeWidth="1.2" opacity="0.4"  />
        <polygon className="fh7" points={hex(100)}       fill="none" stroke="#00f0ff" strokeWidth="1.5" opacity="0.55" filter="url(#fglow-f)" />

        {/* Triangle pairs (Star of David → fractal pattern) */}
        <polygon className="ft1" points={tri(360)}               fill="none" stroke="#00f0ff" strokeWidth="0.6" opacity="0.12" />
        <polygon className="ft2" points={tri(360, Math.PI/2)}    fill="none" stroke="#00f0ff" strokeWidth="0.6" opacity="0.12" />
        <polygon className="ft3" points={tri(240)}               fill="none" stroke="#0a6b72" strokeWidth="0.8" opacity="0.2" />
        <polygon className="ft4" points={tri(240, Math.PI/2)}    fill="none" stroke="#0a6b72" strokeWidth="0.8" opacity="0.2" />
        <polygon className="ft5" points={tri(155)}               fill="none" stroke="#00f0ff" strokeWidth="1.0" opacity="0.3" filter="url(#fblur)" />
        <polygon className="ft6" points={tri(155, Math.PI/2)}    fill="none" stroke="#00f0ff" strokeWidth="1.0" opacity="0.3" filter="url(#fblur)" />

        {/* Radial lines from center to hex vertices */}
        {Array.from({ length: 6 }, (_, k) => {
          const a = (Math.PI / 3) * k;
          return (
            <line key={k}
              x1={cx} y1={cy}
              x2={(cx + 440 * Math.cos(a)).toFixed(1)}
              y2={(cy + 440 * Math.sin(a)).toFixed(1)}
              stroke="#00f0ff" strokeWidth="0.4" opacity="0.08"
            />
          );
        })}

        {/* Orbiting dots */}
        {orbitDots.map((d, k) => (
          <circle key={k}
            cx={cx} cy={cy - 160} r="3"
            fill="#00f0ff" opacity="0.7"
            className="fo"
            style={{ animationDelay: `${d.delay}s`, animationDuration: `${18 + k * 1.5}s` }}
            filter="url(#fglow-f)"
          />
        ))}

        {/* Center core */}
        <circle cx={cx} cy={cy} r="12" fill="#00f0ff" opacity="0.25" filter="url(#fglow-f)" />
        <circle cx={cx} cy={cy} r="4"  fill="#00f0ff" opacity="0.9"  filter="url(#fglow-f)" />
      </svg>
    </div>
  );
}

export default function Page() {
  return (
    <div className="min-h-screen flex bg-black relative overflow-hidden">
      <FractalBackground />

      {/* Subtle overlay for depth */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      {/* Left Side — O3C logo hero */}
      <div className="flex-1 hidden lg:flex items-center justify-center p-8 relative z-10">
        <div className="max-w-lg text-center">
          <img
            src="/o3c-logo.png"
            alt="O3C Platform"
            className="w-80 h-80 object-contain mx-auto gentle-float drop-shadow-2xl"
            style={{ filter: 'drop-shadow(0 0 32px rgba(0,240,255,0.45))' }}
          />
          <p className="mt-6 text-cyan-400/70 text-sm tracking-widest uppercase font-light">
            Sovereign AI Gateway
          </p>
        </div>
      </div>

      {/* Right Side — Sign In */}
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="w-full max-w-md bg-black/30 backdrop-blur-md rounded-2xl p-8 border border-cyan-900/30">
          <SignIn />
        </div>
      </div>
    </div>
  );
}
