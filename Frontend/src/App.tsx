import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Game from "./pages/Game";
import Lobby from "./pages/Lobby";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import TeacherGame from "./pages/TeacherGame";

const queryClient = new QueryClient();

// BASE_URL is set by Vite at build time: '/' or '/play-api/way-maze/'
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={basename}>
        <Routes>
          {/* <Route path="/" element={<Index />} /> */}
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/lobby/:code" element={<Lobby />} />
          <Route path="/game" element={<Game />} />
          <Route path="/dashboard/:quizId" element={<Dashboard/>} />
          <Route path="/dashboard/game" element={<TeacherGame/>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
