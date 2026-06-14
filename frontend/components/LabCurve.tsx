"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function LabCurve({
  curve,
}: {
  curve: { dates: string[]; original: number[]; with_rule: number[] };
}) {
  const data = curve.dates.map((d, i) => ({
    date: d,
    original: curve.original[i],
    with_rule: curve.with_rule[i],
  }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} unit="₹" />
          <Tooltip
            contentStyle={{ background: "#0f111c", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
            labelStyle={{ color: "#f8fafc" }}
          />
          <Line type="monotone" dataKey="original" stroke="#64748b" strokeWidth={1.5} dot={false} name="Original" />
          <Line type="monotone" dataKey="with_rule" stroke="#3b82f6" strokeWidth={2} dot={false} name="With Rule" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
