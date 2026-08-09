import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Link } from 'wouter';
import { RecentSearchesProvider } from './context/recent-searches';
import Home from './pages/Home';
import Monitoring from './pages/Monitoring';

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <p className="font-mono text-6xl font-bold leading-none text-primary">
        404
      </p>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link
        href="/"
        className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Back home
      </Link>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/monitoring" component={Monitoring} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RecentSearchesProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
      </RecentSearchesProvider>
    </QueryClientProvider>
  );
}

export default App;
