import { Link } from "react-router-dom";
import { useT } from "../lib/i18n.jsx";

export default function NotFound() {
  const t = useT();
  return (
    <div className="min-h-[60vh] grid place-items-center px-4 text-center">
      <div>
        <div className="text-7xl font-black text-primary">404</div>
        <h1 className="text-2xl font-bold mt-4">{t("not_found")}</h1>
        <p className="text-muted-foreground mt-2">{t("not_found_sub")}</p>
        <Link
          to="/"
          className="inline-block mt-6 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition"
        >
          {t("back_home")}
        </Link>
      </div>
    </div>
  );
}
