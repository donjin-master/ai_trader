"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  contentStyle: { background: "#18181b", border: "1px solid #27272a", borderRadius: 8 },
  labelStyle: { color: "#f4f4f5" },
};

export function EquityCurve({ data }: { data: { date: string; cumulative: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="date" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} unit="%" />
          <Tooltip {...tooltipStyle} />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3, fill: "#3b82f6" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WinLossByDay({
  data,
}: {
  data: { date: string; wins: number; losses: number }[];
}) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="date" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          <Bar dataKey="wins" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
          <Bar dataKey="losses" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ConfidenceScatter({
  data,
}: {
  data: { confidence: number; pnl_pct: number }[];
}) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="confidence"
            type="number"
            domain={[0, 10]}
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            name="Confidence"
          />
          <YAxis dataKey="pnl_pct" type="number" tick={{ fill: "#a1a1aa", fontSize: 11 }} unit="%" />
          <Tooltip {...tooltipStyle} />
          <Scatter data={data}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.pnl_pct >= 0 ? "#22c55e" : "#ef4444"} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RegretTrend({ data }: { data: { date: string; regret: number }[] }) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="date" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} unit="%" />
          <Tooltip {...tooltipStyle} />
          <Line type="monotone" dataKey="regret" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CalibrationChart({
  data,
}: {
  data: { confidence: number; total_trades: number; wins: number; win_rate_pct: number }[];
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="confidence"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            label={{ value: "Boardroom Confidence", position: "insideBottom", offset: -5, fill: "#71717a", fontSize: 10 }}
          />
          <YAxis
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            unit="%"
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
            labelStyle={{ color: "#f4f4f5" }}
            formatter={(value: any, name: any) => {
              if (name === "win_rate_pct") {
                return [`${value}%`, "Win Rate"];
              }
              return [value, name];
            }}
          />
          <Bar dataKey="win_rate_pct" fill="#3b82f6" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => {
              const color = entry.win_rate_pct >= 55 ? "#10b981" : entry.win_rate_pct >= 40 ? "#eab308" : "#ef4444";
              return <Cell key={`cell-${index}`} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

