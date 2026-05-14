import Sidebar from "../Sidebar/Sidebar.jsx";
import Topbar from "../Topbar/Topbar.jsx";
import MarketSessionStrip from "../../components/MarketSessionStrip.jsx";

export default function AppLayout({ children }) {
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <MarketSessionStrip />
        <Topbar />
        <section className="page">{children}</section>
      </main>
    </div>
  );
}
