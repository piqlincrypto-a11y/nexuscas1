/** Single source of truth for the game catalogue used by Home / Casino / footer. */
export const GAMES = [
  { key: "g_crash", href: "/casino/crash", emoji: "🚀", color: "from-orange-500/20 to-red-500/20", border: "border-orange-500/20", badge: "Hot", badgeColor: "bg-orange-500" },
  { key: "g_dice", href: "/casino/dice", emoji: "🎲", color: "from-violet-500/20 to-purple-500/20", border: "border-violet-500/20" },
  { key: "g_mines", href: "/casino/mines", emoji: "💣", color: "from-red-500/20 to-rose-500/20", border: "border-red-500/20" },
  { key: "g_limbo", href: "/casino/limbo", emoji: "🎯", color: "from-blue-500/20 to-cyan-500/20", border: "border-blue-500/20" },
  { key: "g_roulette", href: "/casino/roulette", emoji: "🎡", color: "from-emerald-500/20 to-teal-500/20", border: "border-emerald-500/20" },
  { key: "g_slots", href: "/casino/slots", emoji: "🎰", color: "from-amber-500/20 to-yellow-500/20", border: "border-amber-500/20", badge: "New", badgeColor: "bg-primary" },
  { key: "g_plinko", href: "/casino/plinko", emoji: "🔻", color: "from-pink-500/20 to-fuchsia-500/20", border: "border-pink-500/20" },
  { key: "g_wheel", href: "/casino/wheel", emoji: "🌀", color: "from-teal-500/20 to-emerald-500/20", border: "border-teal-500/20" },
  { key: "g_keno", href: "/casino/keno", emoji: "🎱", color: "from-indigo-500/20 to-blue-500/20", border: "border-indigo-500/20" },
  { key: "g_hilo", href: "/casino/hilo", emoji: "🃏", color: "from-rose-500/20 to-orange-500/20", border: "border-rose-500/20" },
  { key: "g_mproulette", href: "/mproulette", emoji: "🏆", color: "from-cyan-500/20 to-sky-500/20", border: "border-cyan-500/20", badge: "MP", badgeColor: "bg-accent" },
  { key: "g_poker", href: "/poker", emoji: "♠️", color: "from-purple-500/20 to-indigo-500/20", border: "border-purple-500/20", badge: "MP", badgeColor: "bg-accent" },
];

export const SUB_KEYS = {
  g_crash: "g_crash_sub",
  g_dice: "g_dice_sub",
  g_mines: "g_mines_sub",
  g_limbo: "g_limbo_sub",
  g_roulette: "g_roulette_sub",
  g_slots: "g_slots_sub",
  g_plinko: "g_plinko_sub",
  g_wheel: "g_wheel_sub",
  g_keno: "g_keno_sub",
  g_hilo: "g_hilo_sub",
  g_mproulette: "g_mproulette_sub",
  g_poker: "g_poker_sub",
};
