import React from 'react';

/** Tiny dependency-free SVG charts for the admin console. */

interface SeriesPoint { label: string; value: number }

export const BarChart: React.FC<{ data: SeriesPoint[]; color?: string; height?: number }> = ({ data, color = '#7c3aed', height = 140 }) => {
  const max = Math.max(1, ...data.map(d => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Bar chart">
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1="0" x2="100" y1={(height / 2) * f} y2={(height / 2) * f} stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.3" />
      ))}
      {data.map((d, i) => {
        const h = (d.value / max) * (height / 2 - 4);
        return (
          <g key={d.label}>
            <rect x={i * w + w * 0.15} y={height / 2 - h} width={w * 0.7} height={Math.max(h, d.value > 0 ? 0.8 : 0)} rx="0.8" fill={color}>
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
};

export const LineChart: React.FC<{ data: SeriesPoint[]; color?: string; height?: number }> = ({ data, color = '#2563eb', height = 140 }) => {
  const max = Math.max(1, ...data.map(d => d.value));
  const step = data.length > 1 ? 100 / (data.length - 1) : 100;
  const pts = data.map((d, i) => [i * step, height / 2 - 3 - (d.value / max) * (height / 2 - 8)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L100,${height / 2} L0,${height / 2} Z`;
  return (
    <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Line chart">
      <path d={area} fill={color} fillOpacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="0.9" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.1" fill={color}>
          <title>{`${data[i].label}: ${data[i].value}`}</title>
        </circle>
      ))}
    </svg>
  );
};

export const Sparkline: React.FC<{ values: number[]; color?: string }> = ({ values, color = '#10b981' }) => {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(18 - (v / max) * 16).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-6" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
};

export const Donut: React.FC<{ parts: { label: string; value: number; color: string }[]; size?: number }> = ({ parts, size = 120 }) => {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Distribution chart">
      <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="14" />
      {total > 0 && parts.map(p => {
        const len = (p.value / total) * c;
        const el = (
          <circle
            key={p.label}
            cx="50" cy="50" r={r} fill="none" stroke={p.color} strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)"
          >
            <title>{`${p.label}: ${p.value}`}</title>
          </circle>
        );
        offset += len;
        return el;
      })}
      <text x="50" y="54" textAnchor="middle" fontSize="16" fontWeight="700" fill="currentColor">{total}</text>
    </svg>
  );
};
