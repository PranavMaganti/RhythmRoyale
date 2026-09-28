import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router";
import { OFFLINE } from "./config";
import Daily from "./pages/Daily";
import Home from "./pages/Home";
import Practice from "./pages/Practice";
import Royale from "./pages/Royale";

// The offline build is a single file that may be opened from anywhere, so it
// can't rely on the server rewriting paths to index.html.
const Router = OFFLINE ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/royale" element={<Royale />} />
        <Route path="/daily" element={<Daily />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
