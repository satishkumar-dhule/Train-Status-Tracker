import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SpanStatusCode } from '@opentelemetry/api';
import { Route, Switch, Router as WouterRouter, Link } from 'wouter';
import { I18nProvider } from './lib/i18n';
import { RecentSearchesProvider } from './context/recent-searches';
import Home from './pages/Home';
import { getTrainStatusQueryParams, startBusinessSpan } from './lib/telemetry/queries';

/**
 * Emits one `train_status.lookup` span per completed status query (success or
 * error), tagged with the train number so backend traces and RUM join up.
 * Using a QueryCache keeps this global — every consumer of the generated
 * `useGetTrainStatus` hook is covered.
 */
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onSuccess(_data, query) {
      const params = getTrainStatusQueryParams(query.queryKey);
      if (params.train_number === undefined) return;
      const span = startBusinessSpan('train_status.lookup', {
        'train.number': params.train_number,
        'query.success': true,
      });
      span.end();
    },
    onError(error, query) {
      const params = getTrainStatusQueryParams(query.queryKey);
      if (params.train_number === undefined) return;
      const span = startBusinessSpan('train_status.lookup', {
        'train.number': params.train_number,
        'query.success': false,
      });
      span.recordException(
        error instanceof Error ? error : { message: String(error) },
      );
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    },
  }),
});

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <p className="font-mono text-6xl font-bold leading-none text-primary">
        404
      </p>
      <h1 className="font-sans text-lg font-semibold text-foreground">
        Page not found
      </h1>
      <Link
        href="/"
        className="inline-flex h-10 items-center rounded-full bg-brand px-4 font-sans text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-strong"
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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RecentSearchesProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </RecentSearchesProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
