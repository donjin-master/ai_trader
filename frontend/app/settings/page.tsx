"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, type RiskProfile } from "@/lib/api";
import { Save, User, Settings2, Bell, Link, Shield, CreditCard, Database } from "lucide-react";

const TABS = ["Profile", "Trading", "AI Preferences", "Notifications", "Integrations", "Security", "Billing", "Data & Privacy"];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="relative inline-flex shrink-0 items-center"
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: value ? "var(--accent-primary)" : "rgba(255,255,255,0.1)",
        border: `1px solid ${value ? "var(--accent-primary)" : "rgba(255,255,255,0.15)"}`,
        transition: "all 0.2s",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: value ? 22 : 2,
          width: 18, height: 18, borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--bg-input)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)",
        color: "var(--text-primary)",
        fontSize: "var(--text-sm)",
        padding: "6px 10px",
        outline: "none",
        cursor: "pointer",
        width: "100%",
      }}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: "var(--bg-input)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)",
        color: "var(--text-primary)",
        fontSize: "var(--text-sm)",
        padding: "8px 12px",
        outline: "none",
        width: "100%",
      }}
    />
  );
}

function NumberInput({ value, onChange, suffix, min, max }: { value: number; onChange: (v: number) => void; suffix?: string; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: "var(--bg-input)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)",
          color: "var(--text-primary)",
          fontSize: "var(--text-sm)",
          padding: "8px 12px",
          outline: "none",
          width: 90,
          textAlign: "right",
        }}
      />
      {suffix && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{suffix}</span>}
    </div>
  );
}

const NOTIFICATION_PREFS = [
  { id: "trade_alerts", label: "Trade Alerts", desc: "Get notified about trade opportunities", icon: "📊" },
  { id: "executions", label: "Trade Executions", desc: "Get notified when trades are executed", icon: "⚡" },
  { id: "risk_alerts", label: "Risk Alerts", desc: "Get notified about risk management events", icon: "⚠️" },
  { id: "daily_reports", label: "Daily Reports", desc: "Receive daily performance reports", icon: "📋" },
  { id: "weekly_summary", label: "Weekly Summary", desc: "Receive weekly performance summary", icon: "📅" },
];

const NOTIFICATION_CHANNELS = [
  { id: "in_app", label: "In-App Notifications", detail: "" },
  { id: "email", label: "Email Notifications", detail: "apoorv@aitrader.com" },
  { id: "sms", label: "SMS Notifications", detail: "+91 98765 43210" },
  { id: "telegram", label: "Telegram Bot", detail: "@ai_trader_bot" },
  { id: "discord", label: "Discord Webhook", detail: "Not configured" },
];

const INTEGRATIONS = [
  { name: "Binance", icon: "🟡", status: "Connected" },
  { name: "Bybit", icon: "⬛", status: "Connected" },
  { name: "TradingView", icon: "📈", status: "Connected" },
  { name: "Telegram", icon: "✈️", status: "Connected" },
  { name: "Google Calendar", icon: "📅", status: "Not Connected" },
  { name: "Slack", icon: "💬", status: "Not Connected" },
  { name: "Discord", icon: "🎮", status: "Not Connected" },
];

const SECURITY_ITEMS = [
  { label: "Change Password", detail: "Last changed 30 days ago", action: ">" },
  { label: "Two-Factor Authentication", detail: "Enabled", action: ">", valueColor: "var(--color-bull)" },
  { label: "Login Sessions", detail: "3 active sessions", action: ">" },
  { label: "API Keys", detail: "Manage your API keys", action: ">" },
  { label: "Data Export", detail: "Export your data", action: ">" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("Profile");
  const [toast, setToast] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Risk profile data
  const { data: serverProfile, mutate } = useSWR<RiskProfile | null>(
    "risk-profile", () => api.riskProfile()
  );
  const [profile, setProfile] = useState<RiskProfile | null>(null);
  useEffect(() => {
    if (serverProfile && !profile) setProfile(serverProfile);
  }, [serverProfile, profile]);

  const save = useCallback(
    (updates: Partial<RiskProfile>) => {
      setProfile((p) => (p ? { ...p, ...updates } : p));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const result = await api.updateRiskProfile(updates);
        if (result) {
          setToast("Settings saved");
          mutate(result, { revalidate: false });
        } else {
          setToast("Save failed");
        }
        setTimeout(() => setToast(null), 2000);
      }, 600);
    },
    [mutate]
  );

  // Notification toggles state
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    trade_alerts: true, executions: true, risk_alerts: true, daily_reports: true, weekly_summary: false,
  });
  const [notifChannels, setNotifChannels] = useState<Record<string, boolean>>({
    in_app: true, email: true, sms: false, telegram: true, discord: false,
  });

  // AI Preferences
  const [primaryModel, setPrimaryModel] = useState("Gemini 2.5 Pro");
  const [backupModel, setBackupModel] = useState("Claude 3.5 Sonnet");
  const [useMultiple, setUseMultiple] = useState(true);
  const [analysisDepth, setAnalysisDepth] = useState("Balanced");
  const [learningPrefs, setLearningPrefs] = useState({
    continuousLearning: true, autoUpdateDNA: true,
    learnFromCommunity: false, includeExternalData: true,
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <Settings2 size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>SETTINGS</h1>
            <p className="hidden sm:block" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Manage your account, preferences, and system configurations</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {toast && (
            <span className="rounded-full px-3 py-1 font-semibold"
              style={{ background: "rgba(38,208,124,0.15)", border: "1px solid rgba(38,208,124,0.3)", color: "var(--color-bull)", fontSize: "var(--text-xs)" }}>
              {toast}
            </span>
          )}
          <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => showToast("Changes saved!")}>
            <Save size={13} /> <span className="hidden sm:inline">Save Changes</span>
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {/* Profile Tab */}
      {activeTab === "Profile" && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {/* Profile Information */}
          <div className="card">
            <div className="section-label mb-3">Profile Information</div>
            <div className="flex flex-col items-center mb-4">
              <div className="relative">
                <div className="flex h-20 w-20 items-center justify-center rounded-full font-bold text-white"
                  style={{ background: "var(--accent-primary)", fontSize: 32 }}>A</div>
                <div className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", fontSize: 12, cursor: "pointer" }}>📷</div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Full Name</div>
                <TextInput value="Apoorv" onChange={() => {}} />
              </div>
              <div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Email Address</div>
                <TextInput value="apoorv@aitrader.com" onChange={() => {}} />
              </div>
              <div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Username</div>
                <TextInput value="apoorv_trader" onChange={() => {}} />
              </div>
              <div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Bio</div>
                <textarea
                  defaultValue="Building the future of AI-powered trading."
                  rows={3}
                  style={{
                    background: "var(--bg-input)", border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-md)", color: "var(--text-primary)",
                    fontSize: "var(--text-sm)", padding: "8px 12px", outline: "none", width: "100%", resize: "vertical",
                  }}
                />
              </div>
              <button type="button" className="btn-primary w-full" style={{ textAlign: "center" }}>
                Update Profile
              </button>
            </div>
          </div>

          {/* Trading Preferences */}
          <div className="card">
            <div className="section-label mb-3">Trading Preferences</div>
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Default Market</div>
                  <Select value="Crypto" onChange={() => {}} options={["Crypto", "Stocks", "Forex"]} />
                </div>
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Default Exchange</div>
                  <Select value="Binance" onChange={() => {}} options={["Binance", "Bybit", "Delta"]} />
                </div>
              </div>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Default Pair</div>
                  <Select value="BTC/USDT" onChange={() => {}} options={["BTC/USDT", "ETH/USDT", "SOL/USDT"]} />
                </div>
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Time Zone</div>
                  <Select value="Asia/Kolkata (UTC +5:30)" onChange={() => {}} options={["Asia/Kolkata (UTC +5:30)", "UTC", "US/Eastern"]} />
                </div>
              </div>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Default TF</div>
                  <Select value="4H" onChange={() => {}} options={["15m", "1H", "4H", "1D"]} />
                </div>
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Risk Profile</div>
                  <Select value="Moderate" onChange={() => {}} options={["Conservative", "Moderate", "Aggressive"]} />
                </div>
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Currency</div>
                  <Select value="INR" onChange={() => {}} options={["INR", "USD", "USDT"]} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Leverage Preference</div>
                <TextInput value="10x" onChange={() => {}} />
              </div>

              <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}>
                <div className="section-label mb-3">Risk Management</div>
                {profile && (
                  <div className="flex flex-col gap-3">
                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                      <div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Risk per Trade</div>
                        <NumberInput value={profile.risk_per_trade_pct} onChange={(v) => save({ risk_per_trade_pct: v })} suffix="%" min={0.1} max={5} />
                      </div>
                      <div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Max Daily Loss</div>
                        <NumberInput value={profile.daily_loss_limit_pct} onChange={(v) => save({ daily_loss_limit_pct: v })} suffix="%" min={1} max={20} />
                      </div>
                      <div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Max Drawdown</div>
                        <NumberInput value={10} onChange={() => {}} suffix="%" />
                      </div>
                    </div>
                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                      <div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Max Positions</div>
                        <NumberInput value={profile.max_concurrent_trades} onChange={(v) => save({ max_concurrent_trades: v })} min={1} max={10} />
                      </div>
                      <div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>SL Type</div>
                        <Select value="ATR Based" onChange={() => {}} options={["ATR Based", "Fixed", "Structure"]} />
                      </div>
                      <div className="flex flex-col justify-between">
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Auto Reduce Size</div>
                        <Toggle value={true} onChange={() => {}} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Preferences */}
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="section-label mb-3">AI Preferences</div>
              <div className="section-label mb-2" style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>AI Model Preferences</div>
              <div className="grid gap-3 mb-3 grid-cols-1 sm:grid-cols-2">
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Primary Model</div>
                  <Select value={primaryModel} onChange={setPrimaryModel} options={["Gemini 2.5 Pro", "GPT-4o", "Claude 3.5 Opus"]} />
                </div>
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Backup Model</div>
                  <Select value={backupModel} onChange={setBackupModel} options={["Claude 3.5 Sonnet", "Gemini 1.5 Pro", "GPT-4o-mini"]} />
                </div>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Use multiple models for better analysis</span>
                <Toggle value={useMultiple} onChange={setUseMultiple} />
              </div>

              <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12, marginBottom: 8 }}>
                <div className="section-label mb-1" style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>AI Analysis Depth</div>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 10 }}>Higher depth provides more detailed analysis but takes longer</p>
                <div className="flex gap-1">
                  {["Fast", "Balanced", "Deep", "Ultra Deep"].map((d) => (
                    <button key={d} type="button" onClick={() => setAnalysisDepth(d)}
                      className="flex-1 rounded-md py-1.5 font-semibold transition-all"
                      style={{
                        fontSize: "var(--text-xs)",
                        background: analysisDepth === d ? "var(--accent-primary)" : "var(--bg-elevated)",
                        color: analysisDepth === d ? "#fff" : "var(--text-secondary)",
                        border: "1px solid var(--border-subtle)",
                      }}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-label mb-3">Learning Preferences</div>
              <div className="flex flex-col gap-3">
                {[
                  { key: "continuousLearning", label: "Enable Continuous Learning" },
                  { key: "autoUpdateDNA", label: "Auto Update Trading DNA" },
                  { key: "learnFromCommunity", label: "Learn from Community Patterns" },
                  { key: "includeExternalData", label: "Include External Market Data" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{label}</span>
                    <Toggle
                      value={learningPrefs[key as keyof typeof learningPrefs]}
                      onChange={(v) => setLearningPrefs((p) => ({ ...p, [key]: v }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === "Notifications" && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div className="card">
            <div className="section-label mb-3">Notification Preferences</div>
            <div className="flex flex-col gap-3">
              {NOTIFICATION_PREFS.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg p-3"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: 18 }}>{p.icon}</span>
                    <div>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>{p.label}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{p.desc}</div>
                    </div>
                  </div>
                  <Toggle value={notifPrefs[p.id]} onChange={(v) => setNotifPrefs((s) => ({ ...s, [p.id]: v }))} />
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="section-label mb-3">Notification Channels</div>
            <div className="flex flex-col gap-3">
              {NOTIFICATION_CHANNELS.map((c) => (
                <div key={c.id} className="flex items-center justify-between">
                  <div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>{c.label}</div>
                    {c.detail && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{c.detail}</div>}
                  </div>
                  <Toggle value={notifChannels[c.id]} onChange={(v) => setNotifChannels((s) => ({ ...s, [c.id]: v }))} />
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost w-full mt-4" style={{ textAlign: "center", fontSize: "var(--text-sm)" }}>
              ✈️ Test All Notifications
            </button>
          </div>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === "Integrations" && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div className="card">
            <div className="section-label mb-3">Integrations</div>
            <div className="flex flex-col gap-2">
              {INTEGRATIONS.map((i) => (
                <div key={i.name} className="flex items-center justify-between rounded-lg px-3 py-2.5"
                  style={{ border: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: 18 }}>{i.icon}</span>
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>{i.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: i.status === "Connected" ? "var(--color-bull)" : "var(--text-muted)" }}>
                      {i.status}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>›</span>
                  </div>
                </div>
              ))}
              <button type="button" className="btn-ghost w-full mt-2" style={{ textAlign: "center", fontSize: "var(--text-sm)" }}>
                Manage All Integrations
              </button>
            </div>
          </div>
          <div className="card">
            <div className="section-label mb-3">Security & Privacy</div>
            <div className="flex flex-col gap-1">
              {SECURITY_ITEMS.map((s) => (
                <div key={s.label} className="flex items-center justify-between rounded-lg px-3 py-2.5 cursor-pointer"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: s.valueColor ?? "var(--text-muted)" }}>{s.detail}</div>
                  </div>
                  <span style={{ color: "var(--text-muted)" }}>›</span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg px-3 py-2.5 cursor-pointer mt-1"
                style={{ border: "1px solid rgba(255,77,106,0.3)", background: "rgba(255,77,106,0.05)" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-bear)", fontWeight: 600 }}>Delete Account</span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Permanently delete your account</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === "Security" && (
        <div className="card">
          <div className="section-label mb-3">Security & Privacy</div>
          <div className="flex flex-col gap-2">
            {SECURITY_ITEMS.map((s) => (
              <div key={s.label} className="flex items-center justify-between rounded-lg px-4 py-3 cursor-pointer"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: s.valueColor ?? "var(--text-muted)" }}>{s.detail}</div>
                </div>
                <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-lg)" }}>›</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trading Tab — uses real risk profile */}
      {activeTab === "Trading" && profile && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div className="card">
            <div className="section-label mb-3">Execution Mode</div>
            <div className="flex flex-col gap-2">
              {(["ADVISORY", "SEMI_AUTO", "AUTONOMOUS", "SCHEDULED"] as const).map((m) => (
                <button key={m} type="button"
                  onClick={() => save({ mode: m })}
                  className="rounded-lg px-4 py-3 text-left transition-all"
                  style={{
                    background: profile.mode === m ? "rgba(108,99,255,0.12)" : "var(--bg-elevated)",
                    border: `1px solid ${profile.mode === m ? "rgba(108,99,255,0.4)" : "var(--border-subtle)"}`,
                  }}>
                  <div style={{ fontWeight: 700, color: profile.mode === m ? "var(--accent-primary)" : "var(--text-primary)", fontSize: "var(--text-sm)" }}>{m}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>
                    {m === "ADVISORY" ? "Monitor only — all trades need your approval" :
                     m === "SEMI_AUTO" ? "Auto-execute within budget, alert for the rest" :
                     m === "AUTONOMOUS" ? "Fully automatic within your rules" :
                     "Only trade during your set windows"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="section-label mb-3">Capital & Budget</div>
              <div className="flex flex-col gap-3">
                {[
                  { label: "Total Capital", value: profile.total_capital, onChange: (v: number) => save({ total_capital: v }), suffix: "₹" },
                  { label: "Daily Budget %", value: profile.daily_budget_pct, onChange: (v: number) => save({ daily_budget_pct: v }), suffix: "%" },
                  { label: "Daily Loss Limit", value: profile.daily_loss_limit_pct, onChange: (v: number) => save({ daily_loss_limit_pct: v }), suffix: "%" },
                  { label: "Max Trades/Day", value: profile.max_trades_per_day, onChange: (v: number) => save({ max_trades_per_day: v }), suffix: "" },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between">
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{r.label}</span>
                    <NumberInput value={r.value} onChange={r.onChange} suffix={r.suffix} />
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="section-label mb-3">Position Management</div>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Risk per Trade %</span>
                  <NumberInput value={profile.risk_per_trade_pct} onChange={(v) => save({ risk_per_trade_pct: v })} suffix="%" min={0.1} max={5} />
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Min Setup Score</span>
                  <NumberInput value={profile.min_setup_score} onChange={(v) => save({ min_setup_score: v })} min={5} max={10} />
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>TP1 Exit %</span>
                  <NumberInput value={profile.tp1_exit_pct} onChange={(v) => save({ tp1_exit_pct: v })} suffix="%" min={10} max={60} />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-label mb-3">Active Instruments</div>
              <div className="flex flex-wrap gap-2">
                {["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP", "XAUUSD_PERP", "BNBUSD_PERP", "ADAUSD_PERP", "XRPUSD_PERP", "DOGEUSD_PERP"].map((inst) => {
                  const isActive = (profile.active_instruments || ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP", "XAUUSD_PERP"]).includes(inst);
                  return (
                    <button
                      key={inst}
                      type="button"
                      onClick={() => {
                        const current = profile.active_instruments || ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP", "XAUUSD_PERP"];
                        const next = isActive ? current.filter((i: string) => i !== inst) : [...current, inst];
                        save({ active_instruments: next });
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "16px",
                        fontSize: "var(--text-xs)",
                        border: `1px solid ${isActive ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                        background: isActive ? "rgba(108,99,255,0.1)" : "var(--bg-elevated)",
                        color: isActive ? "var(--accent-primary)" : "var(--text-secondary)",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      {inst}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account Status */}
      {activeTab === "Billing" && (
        <div className="card">
          <div className="section-label mb-4">Account Status</div>
          <div className="flex items-center justify-between rounded-xl p-4"
            style={{ background: "rgba(108,99,255,0.08)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: "var(--accent-primary)" }}>
                <span style={{ color: "#fff", fontSize: 18 }}>⭐</span>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "var(--text-md)", color: "var(--accent-primary)" }}>Pro Plan</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Member since 12 May 2026</div>
              </div>
            </div>
            <button type="button" className="btn-primary">Manage Plan</button>
          </div>
        </div>
      )}

      {/* AI Preferences standalone tab */}
      {activeTab === "AI Preferences" && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div className="card">
            <div className="section-label mb-3">AI Model Preferences</div>
            <div className="grid gap-3 mb-4 grid-cols-1 sm:grid-cols-2">
              <div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Primary Model</div>
                <Select value={primaryModel} onChange={setPrimaryModel} options={["Gemini 2.5 Pro", "GPT-4o", "Claude 3.5 Opus"]} />
              </div>
              <div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 4 }}>Backup Model</div>
                <Select value={backupModel} onChange={setBackupModel} options={["Claude 3.5 Sonnet", "Gemini 1.5 Pro", "GPT-4o-mini"]} />
              </div>
            </div>
            <div className="flex items-center justify-between mb-4">
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Use multiple models for better analysis</span>
              <Toggle value={useMultiple} onChange={setUseMultiple} />
            </div>
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}>
              <div className="section-label mb-1" style={{ fontSize: "var(--text-xs)" }}>AI Analysis Depth</div>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 10 }}>Higher depth provides more detailed analysis but takes longer</p>
              <div className="flex gap-1">
                {["Fast", "Balanced", "Deep", "Ultra Deep"].map((d) => (
                  <button key={d} type="button" onClick={() => setAnalysisDepth(d)}
                    className="flex-1 rounded-md py-2 font-semibold transition-all"
                    style={{
                      fontSize: "var(--text-xs)",
                      background: analysisDepth === d ? "var(--accent-primary)" : "var(--bg-elevated)",
                      color: analysisDepth === d ? "#fff" : "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                    }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="section-label mb-3">Learning Preferences</div>
            <div className="flex flex-col gap-4">
              {[
                { key: "continuousLearning", label: "Enable Continuous Learning", desc: "AI continuously learns from your closed trades" },
                { key: "autoUpdateDNA", label: "Auto Update Trading DNA", desc: "Automatically update DNA profile with new patterns" },
                { key: "learnFromCommunity", label: "Learn from Community Patterns", desc: "Include anonymized patterns from top traders" },
                { key: "includeExternalData", label: "Include External Market Data", desc: "Use macro data, news sentiment in decisions" },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between">
                  <div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>{desc}</div>
                  </div>
                  <Toggle
                    value={learningPrefs[key as keyof typeof learningPrefs]}
                    onChange={(v) => setLearningPrefs((p) => ({ ...p, [key]: v }))}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Data & Privacy */}
      {activeTab === "Data & Privacy" && (
        <div className="card">
          <div className="section-label mb-3">Data & Privacy</div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-lg px-4 py-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
              <div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>Export Your Data</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Download all your trades, notes, and performance data</div>
              </div>
              <button type="button" className="btn-ghost">Export →</button>
            </div>
            <div className="flex items-center justify-between rounded-lg px-4 py-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
              <div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>Data Retention</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Control how long your data is stored</div>
              </div>
              <Select value="Forever" onChange={() => {}} options={["Forever", "2 Years", "1 Year", "6 Months"]} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
