import { Link } from "react-router-dom";
import { useT } from "../lib/i18n.jsx";
import { GAMES, SUB_KEYS } from "../lib/games.js";

export default function Casino() {
  const t = useT();
  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-black">{t("nav_casino")}</h1>
        <p className="text-muted-foreground mt-1">{t("choose_game")}</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {GAMES.map((g) => (
          <Link
            key={g.key}
            to={g.href}
            className={`group relative rounded-2xl border ${g.border} bg-gradient-to-br ${g.color} p-6 hover:scale-[1.02] transition-transform duration-200`}
          >
            {g.badge && (
              <span className={`absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${g.badgeColor}`}>
                {g.badge}
              </span>
            )}
            <div className="text-5xl mb-4">{g.emoji}</div>
            <h3 className="text-xl font-bold">{t(g.key)}</h3>
            <p className="text-sm text-muted-foreground mt-1">{t(SUB_KEYS[g.key])}</p>
            <div className="mt-4 text-sm font-semibold text-primary opacity-0 group-hover:opacity-100 transition">
              {t("play_now")} →
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
