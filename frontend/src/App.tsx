import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Daily from "./pages/Daily";
import Home from "./pages/Home";
import Practice from "./pages/Practice";
import Royale from "./pages/Royale";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/royale" element={<Royale />} />
        <Route path="/daily" element={<Daily />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
