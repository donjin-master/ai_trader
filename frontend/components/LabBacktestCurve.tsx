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

interface EquityCurvePoint {
  date: string;
  equity: number;
  period: "train" | "test";
}

export default function LabBacktestCurve({
  equityCurve,
}: {
  equityCurve: EquityCurvePoint[];
}) {
  const data = equityCurve.map((pt, i) => {
    const isLastTrain =
      pt.period === "train" &&
      i < equityCurve.length - 1 &&
      equityCurve[i + 1].period === "test";
    const isFirstTest =
      pt.period === "test" && i > 0 && equityCurve[i - 1].period === "train";

    return {
      date: pt.date.includes("T")
        ? new Date(pt.date).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })
        : pt.date,
      train: pt.period === "train" || isFirstTest ? pt.equity : null,
      test: pt.period === "test" || isLastTrain ? pt.equity : null,
    };
  });

  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            domain={["auto", "auto"]}
            tickFormatter={(v) => `₹${v.toLocaleString("en-IN")}`}
          />
          <Tooltip
            contentStyle={{
              background: "#0f111c",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
            }}
            labelStyle={{ color: "#f8fafc" }}
            formatter={(value: any) => [`₹${Number(value).toLocaleString("en-IN")}`, "Equity"]}
          />
          <Line
            type="monotone"
            dataKey="train"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            name="Train Period"
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="test"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            name="Test Period"
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
