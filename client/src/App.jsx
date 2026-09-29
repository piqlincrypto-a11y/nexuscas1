import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth.jsx";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Casino from "./pages/Casino.jsx";
import Dice from "./pages/games/Dice.jsx";
import Crash from "./pages/games/Crash.jsx";
import Mines from "./pages/games/Mines.jsx";
import Limbo from "./pages/games/Limbo.jsx";
import Roulette from "./pages/games/Roulette.jsx";
import Slots from "./pages/games/Slots.jsx";
import Plinko from "./pages/games/Plinko.jsx";
import Wheel from "./pages/games/Wheel.jsx";
import Keno from "./pages/games/Keno.jsx";
import Hilo from "./pages/games/Hilo.jsx";
import MpRoulette from "./pages/games/MpRoulette.jsx";
import Poker from "./pages/games/Poker.jsx";
import Leaderboard from "./pages/Leaderboard.jsx";
import Promotions from "./pages/Promotions.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Auth from "./pages/Auth.jsx";
import Admin from "./pages/Admin.jsx";
import NotFound from "./pages/NotFound.jsx";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/casino" element={<Casino />} />
        <Route path="/casino/dice" element={<Dice />} />
        <Route path="/casino/crash" element={<Crash />} />
        <Route path="/casino/mines" element={<Mines />} />
        <Route path="/casino/limbo" element={<Limbo />} />
        <Route path="/casino/roulette" element={<Roulette />} />
        <Route path="/casino/slots" element={<Slots />} />
        <Route path="/casino/plinko" element={<Plinko />} />
        <Route path="/casino/wheel" element={<Wheel />} />
        <Route path="/casino/keno" element={<Keno />} />
        <Route path="/casino/hilo" element={<Hilo />} />
        <Route path="/mproulette" element={<MpRoulette />} />
        <Route path="/poker" element={<Poker />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/promotions" element={<Promotions />} />
        <Route path="/auth" element={<Auth />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
