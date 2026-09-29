import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../lib/auth.jsx";
import { Link } from "react-router-dom";

/* ---------------- Toasts ---------------- */

let toastListeners = new Set();
let toastId = 0;

export function toast(message, type = "default") {
  const id = ++toastId;
  for (const fn of toastListeners) fn({ id, message, type });
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3500);
    };
    toastListeners.add(add);
    return () => toastListeners.delete(add);
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {items.map((t) => (
        <div
          key={t.id}
          className={`animate-in px-4 py-3 rounded-xl border shadow-xl text-sm backdrop-blur-xl ${
            t.type === "error"
              ? "bg-red-950/80 border-red-500/30 text-red-200"
              : t.type === "success"
              ? "bg-emerald-950/80 border-emerald-500/30 text-emerald-200"
              : "bg-card/95 border-border text-foreground"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Sign-in prompt ---------------- */

export function SignInPrompt({ icon = "🔐", title, description, cta = "Sign In" }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/50 p-8 text-center">
      <span className="text-5xl block mb-4">{icon}</span>
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <p className="text-muted-foreground mb-6">{description}</p>
      <Link
        to="/auth"
        className="inline-block px-8 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition"
      >
        {cta}
      </Link>
    </div>
  );
}

/* ---------------- Bet controls ---------------- */

export function BetPanel({
  betAmount, onBetChange, onBet, loading, disabled, buttonLabel, buttonColor = "bg-primary text-primary-foreground hover:opacity-90",
  extra, maxLabel = "MAX", amountLabel, placeholder,
}) {
  const { user } = useAuth();
  const presets = [1, 5, 10, 50, 100, 500];

  const update = (v) => {
    const n = Math.max(0, Number(v) || 0);
    onBetChange(n);
  };

  if (!user) {
    return <SignInPrompt icon="🎰" title="Sign in to play" description="Create an account and deposit crypto to start playing." />;
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card/50 p-5 space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm text-muted-foreground">{amountLabel || "Bet Amount (USD)"}</label>
        <div className="flex gap-2">
          <input
            type="number"
            min="1"
            step="1"
            value={betAmount}
            placeholder={placeholder}
            onChange={(e) => update(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-secondary/50 border border-border focus:border-primary/60 focus:outline-none font-mono text-sm"
          />
          <div className="flex gap-1">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => update(p)}
                className="px-2 py-2 rounded-lg bg-secondary/60 border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => update(Math.floor((user.balance || 0) / 100))}
              className="px-2 py-2 rounded-lg bg-secondary/60 border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
            >
              {maxLabel}
            </button>
          </div>
        </div>
      </div>
      {extra}
      <button
        onClick={onBet}
        disabled={loading || disabled}
        className={`w-full py-3 rounded-xl font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${buttonColor}`}
      >
        {loading ? "Processing..." : buttonLabel}
      </button>
    </div>
  );
}

/* ---------------- Stat card ---------------- */

export function StatCard({ label, value, sub, accent }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/50 p-5">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent || ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

/* ---------------- Slider ---------------- */

export function RangeSlider({ value, min, max, onChange, step = 1 }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-primary cursor-pointer"
    />
  );
}

/* ---------------- confirm dialog ---------------- */

export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback(
    (message) => new Promise((resolve) => setState({ message, resolve })),
    []
  );
  const dialog = state ? (
    <ConfirmDialog
      message={state.message}
      onAnswer={(v) => { state.resolve(v); setState(null); }}
    />
  ) : null;
  return [confirm, dialog];
}

function ConfirmDialog({ message, onAnswer }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <div className="animate-in rounded-2xl border border-border bg-card p-6 max-w-sm w-full">
        <p className="text-sm text-muted-foreground mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => onAnswer(false)}
            className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onAnswer(true)}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
